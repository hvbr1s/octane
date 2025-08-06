import { Transaction, Connection, Keypair } from '@solana/web3.js';
import type { Cache } from 'cache-manager';
import base58 from 'bs58';
import {
    sha256,
    simulateRawTransaction,
    validateTransaction,
    validateTransfer,
    TokenFee,
    validateInstructions,
    logger,
    TransactionLogger,
} from '../core';

/**
 * Sign transaction by fee payer if the first instruction is a transfer of token fee to given account
 *
 * @param connection           Connection to a Solana node
 * @param transaction          Transaction to sign
 * @param feePayer             Keypair for fee payer
 * @param maxSignatures        Maximum allowed signatures in the transaction including fee payer's
 * @param lamportsPerSignature Maximum fee payment in lamports
 * @param allowedTokens        List of tokens that can be used with token fee receiver accounts and fee details
 * @param cache                A cache to store duplicate transactions
 * @param sameSourceTimeout    An interval for transactions with same token fee source, ms
 *
 * @return {signature: string} Transaction signature by fee payer
 */
export async function signWithTokenFee(
    connection: Connection,
    transaction: Transaction,
    feePayer: Keypair,
    maxSignatures: number,
    lamportsPerSignature: number,
    allowedTokens: TokenFee[],
    cache: Cache,
    sameSourceTimeout = 5000
): Promise<{ signature: string }> {
    const initialContext = TransactionLogger.extractTransactionContext(transaction, {
        feePayer: feePayer.publicKey.toBase58()
    });
    
    const journey = logger.createJourneyTracker(initialContext);
    
    try {
        journey.stage('DUPLICATE_CHECK', 'Checking for duplicate transactions');
        // Prevent simple duplicate transactions using a hash of the message
        let key = `transaction/${base58.encode(sha256(transaction.serializeMessage()))}`;
        if (await cache.get(key)) {
            throw new Error('duplicate transaction');
        }
        await cache.set(key, true);

        journey.stage('TRANSACTION_VALIDATION', 'Validating and signing transaction');
        // Check that the transaction is basically valid, sign it, and serialize it, verifying the signatures
        const { signature, rawTransaction } = await validateTransaction(
            connection,
            transaction,
            feePayer,
            maxSignatures,
            lamportsPerSignature
        );

        journey.stage('INSTRUCTION_SECURITY', 'Validating instruction security');
        await validateInstructions(transaction, feePayer);

        journey.stage('TRANSFER_VALIDATION', 'Validating token transfer');
        // Check that the transaction contains a valid transfer to Octane's token account
        const transfer = await validateTransfer(connection, transaction, allowedTokens);

        journey.stage('SOURCE_LOCKOUT_CHECK', 'Checking source account lockout');
        /*
           An attacker could make multiple signing requests before the transaction is confirmed. If the source token account
           has the minimum fee balance, validation and simulation of all these requests may succeed. All but the first
           confirmed transaction will fail because the account will be empty afterward. To prevent this race condition,
           simulation abuse, or similar attacks, we implement a simple lockout for the source token account
           for a few seconds after the transaction.
         */
        key = `transfer/lastSignature/${transfer.keys.source.pubkey.toBase58()}`;
        const lastSignature: number | undefined = await cache.get(key);
        if (lastSignature && Date.now() - lastSignature < sameSourceTimeout) {
            throw new Error('duplicate transfer');
        }
        await cache.set(key, Date.now());

        journey.stage('TRANSACTION_SIMULATION', 'Simulating transaction');
        await simulateRawTransaction(connection, rawTransaction);

        journey.complete({ signature });
        return { signature: signature };
        
    } catch (error) {
        journey.fail(error as Error);
        throw error;
    }
}
