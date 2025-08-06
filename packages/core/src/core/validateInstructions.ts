import { Keypair, Transaction } from '@solana/web3.js';
import { logger, TransactionLogger } from './logger';

// Prevent draining by making sure that the fee payer isn't provided as writable or a signer to any instruction.
// Throws an error if transaction contain instructions that could potentially drain fee payer.
export async function validateInstructions(transaction: Transaction, feePayer: Keypair): Promise<void> {
    const context = TransactionLogger.extractTransactionContext(transaction, {
        feePayer: feePayer.publicKey.toBase58()
    });
    
    logger.info('VALIDATE_INSTRUCTIONS', '🔒 Starting instruction security validation', context);
    
    try {
        logger.debug('VALIDATE_INSTRUCTIONS', `Checking ${transaction.instructions.length} instructions for fee payer security`, context);
        
        for (let i = 0; i < transaction.instructions.length; i++) {
            const instruction = transaction.instructions[i];
            logger.debug('VALIDATE_INSTRUCTIONS', `Validating instruction ${i + 1}/${transaction.instructions.length}`, context);
            
            for (const key of instruction.keys) {
                if ((key.isWritable || key.isSigner) && key.pubkey.equals(feePayer.publicKey)) {
                    logger.error('VALIDATE_INSTRUCTIONS', `Fee payer found as ${key.isWritable ? 'writable' : 'signer'} in instruction ${i + 1}`, context, new Error('invalid account'));
                    throw new Error('invalid account');
                }
            }
        }
        
        logger.info('VALIDATE_INSTRUCTIONS', '✅ All instructions passed security validation', context);
        
    } catch (error) {
        logger.error('VALIDATE_INSTRUCTIONS', 'Instruction security validation failed', context, error as Error);
        throw error;
    }
}
