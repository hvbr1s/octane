import { Connection, Transaction, TransactionSignature, Keypair } from '@solana/web3.js';
import base58 from 'bs58';
import { logger, TransactionLogger } from './logger';

// Check that a transaction is basically valid, sign it, and serialize it, verifying the signatures
// This function doesn't check if payer fee was transferred (instead, use validateTransfer) or
// instruction signatures do not include fee payer as a writable account (instead, use validateInstructions).
export async function validateTransaction(
    connection: Connection,
    transaction: Transaction,
    feePayer: Keypair,
    maxSignatures: number,
    lamportsPerSignature: number
): Promise<{ signature: TransactionSignature; rawTransaction: Buffer }> {
    const context = TransactionLogger.extractTransactionContext(transaction, {
        feePayer: feePayer.publicKey.toBase58()
    });

    logger.info('VALIDATE_TRANSACTION', '🔍 Starting transaction validation', context);
    
    try {
        // Check the fee payer and blockhash for basic validity
        logger.debug('VALIDATE_TRANSACTION', 'Checking fee payer and blockhash', context);
        if (!transaction.feePayer?.equals(feePayer.publicKey)) {
            logger.error('VALIDATE_TRANSACTION', 'Fee payer mismatch', context, new Error('invalid fee payer'));
            throw new Error('invalid fee payer');
        }
        if (!transaction.recentBlockhash) {
            logger.error('VALIDATE_TRANSACTION', 'Missing recent blockhash', context, new Error('missing recent blockhash'));
            throw new Error('missing recent blockhash');
        }

        logger.debug('VALIDATE_TRANSACTION', '✅ Fee payer and blockhash validation passed', context);

        // TODO: handle nonce accounts?

        // Check Octane's RPC node for the blockhash to make sure it's synced and the fee is reasonable
        // logger.debug('VALIDATE_TRANSACTION', 'Fetching fee calculator for blockhash', context);
        // const feeCalculator = await connection.getFeeCalculatorForBlockhash(transaction.recentBlockhash);
        // if (!feeCalculator.value) {
        //     logger.error('VALIDATE_TRANSACTION', 'Blockhash not found on network', context, new Error('blockhash not found'));
        //     throw new Error('blockhash not found');
        // }
        // if (feeCalculator.value.lamportsPerSignature > lamportsPerSignature) {
        //     logger.error('VALIDATE_TRANSACTION', `Fee too high: ${feeCalculator.value.lamportsPerSignature} > ${lamportsPerSignature}`, context, new Error('fee too high'));
        //     throw new Error('fee too high');
        // }

        // logger.debug('VALIDATE_TRANSACTION', `✅ Fee validation passed: ${feeCalculator.value.lamportsPerSignature} lamports per signature`, context);

        // Check the signatures for length, the primary signature, and secondary signature(s)
        logger.debug('VALIDATE_TRANSACTION', `Validating signatures (count: ${transaction.signatures.length}, max: ${maxSignatures})`, context);
        if (!transaction.signatures.length) {
            logger.error('VALIDATE_TRANSACTION', 'No signatures found', context, new Error('no signatures'));
            throw new Error('no signatures');
        }
        if (transaction.signatures.length > maxSignatures) {
            logger.error('VALIDATE_TRANSACTION', `Too many signatures: ${transaction.signatures.length} > ${maxSignatures}`, context, new Error('too many signatures'));
            throw new Error('too many signatures');
        }

        const [primary, ...secondary] = transaction.signatures;
        if (!primary.publicKey.equals(feePayer.publicKey)) {
            logger.error('VALIDATE_TRANSACTION', 'Primary signature public key does not match fee payer', context, new Error('invalid fee payer pubkey'));
            throw new Error('invalid fee payer pubkey');
        }
        if (primary.signature) {
            logger.error('VALIDATE_TRANSACTION', 'Fee payer signature already present', context, new Error('invalid fee payer signature'));
            throw new Error('invalid fee payer signature');
        }

        logger.debug('VALIDATE_TRANSACTION', `Validating ${secondary.length} secondary signatures`, context);
        for (const signature of secondary) {
            if (!signature.publicKey) {
                logger.error('VALIDATE_TRANSACTION', 'Missing public key in secondary signature', context, new Error('missing public key'));
                throw new Error('missing public key');
            }
            if (!signature.signature) {
                logger.error('VALIDATE_TRANSACTION', 'Missing signature in secondary signature', context, new Error('missing signature'));
                throw new Error('missing signature');
            }
        }

        logger.debug('VALIDATE_TRANSACTION', '✅ All signature validations passed', context);

        // Add the fee payer signature
        logger.debug('VALIDATE_TRANSACTION', 'Adding fee payer signature', context);
        transaction.partialSign(feePayer);

        // Serialize the transaction, verifying the signatures
        logger.debug('VALIDATE_TRANSACTION', 'Serializing transaction', context);
        const rawTransaction = transaction.serialize();

        // Return the primary signature (aka txid) and serialized transaction
        const signature = base58.encode(transaction.signature!);
        const finalContext = { ...context, signature };
        
        logger.info('VALIDATE_TRANSACTION', '✅ Transaction validation completed successfully', finalContext);
        return { signature, rawTransaction };

    } catch (error) {
        logger.error('VALIDATE_TRANSACTION', 'Transaction validation failed', context, error as Error);
        throw error;
    }
}
