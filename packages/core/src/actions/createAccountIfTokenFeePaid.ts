import { Connection, Keypair, Transaction } from '@solana/web3.js';
import {
    TokenFee,
    sha256,
    simulateRawTransaction,
    validateAccountInitializationInstructions,
    validateTransaction,
    validateTransfer,
    logger,
    TransactionLogger,
} from '../core';
import { Cache } from 'cache-manager';
import base58 from 'bs58';

/**
 * Sign transaction by fee payer if the first instruction is a transfer of a fee to given account and the second instruction
 * creates an associated token account with initialization fees by fee payer.
 *
 * @param connection           Connection to a Solana node
 * @param transaction          Transaction to sign
 * @param maxSignatures        Maximum allowed signatures in the transaction including fee payer's
 * @param lamportsPerSignature Maximum transaction fee payment in lamports
 * @param allowedTokens        List of tokens that can be used with token fee receiver accounts and fee details
 * @param feePayer             Keypair for fee payer
 * @param cache                A cache to store duplicate transactions
 * @param sameSourceTimeout    An interval for transactions with same token fee source, ms
 *
 * @return {signature: string} Transaction signature by fee payer
 */
export async function createAccountIfTokenFeePaid(
    connection: Connection,
    transaction: Transaction,
    feePayer: Keypair,
    maxSignatures: number,
    lamportsPerSignature: number,
    allowedTokens: TokenFee[],
    cache: Cache,
    sameSourceTimeout = 5000
) {
    const initialContext = TransactionLogger.extractTransactionContext(transaction, {
        feePayer: feePayer.publicKey.toBase58()
    });
    
    const journey = logger.createJourneyTracker(initialContext);
    
    try {
        journey.stage('DUPLICATE_CHECK', 'Checking for duplicate account creation transactions');
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

        journey.stage('ACCOUNT_INIT_VALIDATION', 'Validating account initialization instructions');
        // Check that transaction only contains transfer and a valid new account
        await validateAccountInitializationInstructions(connection, transaction, feePayer, cache);

        journey.stage('TRANSFER_VALIDATION', 'Validating token transfer for account creation');
        // Check that the transaction contains a valid transfer to Octane's token account
        const transfer = await validateTransfer(connection, transaction, allowedTokens);

        journey.stage('SOURCE_LOCKOUT_CHECK', 'Checking source account lockout for account creation');
        key = `createAccount/lastSignature/${transfer.keys.source.pubkey.toBase58()}`;
        const lastSignature: number | undefined = await cache.get(key);
        if (lastSignature && Date.now() - lastSignature < sameSourceTimeout) {
            throw new Error('duplicate transfer');
        }
        await cache.set(key, Date.now());

        journey.stage('TRANSACTION_SIMULATION', 'Simulating account creation transaction');
        await simulateRawTransaction(connection, rawTransaction);

        journey.complete({ signature });
        return { signature: signature };
        
    } catch (error) {
        journey.fail(error as Error);
        throw error;
    }
}
