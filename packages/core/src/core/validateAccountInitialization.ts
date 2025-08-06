import { Connection, Transaction, Keypair } from '@solana/web3.js';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Cache } from 'cache-manager';
import { areInstructionsEqual } from './instructions';
import { logger, TransactionLogger } from './logger';

export async function validateAccountInitializationInstructions(
    connection: Connection,
    originalTransaction: Transaction,
    feePayer: Keypair,
    cache: Cache
): Promise<void> {
    const context = TransactionLogger.extractTransactionContext(originalTransaction, {
        feePayer: feePayer.publicKey.toBase58()
    });
    
    logger.info('VALIDATE_ACCOUNT_INIT', '🏗️ Starting account initialization validation', context);
    
    try {
        const transaction = Transaction.from(originalTransaction.serialize({ requireAllSignatures: false }));

        // Transaction instructions should be: [fee transfer, account initialization]
        // The fee transfer is validated with validateTransfer in the action function.
        logger.debug('VALIDATE_ACCOUNT_INIT', `Checking instruction count (expected: 2, actual: ${transaction.instructions.length})`, context);
        if (transaction.instructions.length != 2) {
            logger.error('VALIDATE_ACCOUNT_INIT', `Invalid instruction count: ${transaction.instructions.length}`, context, new Error('transaction should contain 2 instructions: fee payment, account init'));
            throw new Error('transaction should contain 2 instructions: fee payment, account init');
        }
        const [, instruction] = transaction.instructions;

        logger.debug('VALIDATE_ACCOUNT_INIT', 'Validating account initialization instruction program', context);
        if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
            logger.error('VALIDATE_ACCOUNT_INIT', `Wrong program ID: ${instruction.programId.toBase58()}`, context, new Error('account instruction should call associated token program'));
            throw new Error('account instruction should call associated token program');
        }

        const [, , ownerMeta, mintMeta] = instruction.keys;
        const associatedToken = await getAssociatedTokenAddress(mintMeta.pubkey, ownerMeta.pubkey);
        
        const accountContext = {
            ...context,
            associatedToken: associatedToken.toBase58(),
            owner: ownerMeta.pubkey.toBase58(),
            token: mintMeta.pubkey.toBase58()
        };
        
        logger.debug('VALIDATE_ACCOUNT_INIT', 'Calculated associated token address', accountContext);

        // Check if account isn't already created
        logger.debug('VALIDATE_ACCOUNT_INIT', 'Checking if account already exists', accountContext);
        if (await connection.getAccountInfo(associatedToken, 'confirmed')) {
            logger.error('VALIDATE_ACCOUNT_INIT', 'Account already exists on chain', accountContext, new Error('account already exists'));
            throw new Error('account already exists');
        }
        
        logger.debug('VALIDATE_ACCOUNT_INIT', '✅ Account does not exist yet', accountContext);

        logger.debug('VALIDATE_ACCOUNT_INIT', 'Validating instruction format against reference', accountContext);
        const referenceInstruction = createAssociatedTokenAccountInstruction(
            feePayer.publicKey,
            associatedToken,
            ownerMeta.pubkey,
            mintMeta.pubkey
        );
        if (!areInstructionsEqual(referenceInstruction, instruction)) {
            logger.error('VALIDATE_ACCOUNT_INIT', 'Instruction does not match expected format', accountContext, new Error('unable to match associated account instruction'));
            throw new Error('unable to match associated account instruction');
        }
        
        logger.debug('VALIDATE_ACCOUNT_INIT', '✅ Instruction format validation passed', accountContext);

        // Prevent trying to create same accounts too many times within a short timeframe (per one recent blockhash)
        const cacheKey = `account/${transaction.recentBlockhash}_${associatedToken.toString()}`;
        logger.debug('VALIDATE_ACCOUNT_INIT', `Checking cache for duplicate account creation (key: ${cacheKey.slice(0, 50)}...)`, accountContext);
        if (await cache.get(cacheKey)) {
            logger.error('VALIDATE_ACCOUNT_INIT', 'Duplicate account creation attempt within same blockhash', accountContext, new Error('duplicate account within same recent blockhash'));
            throw new Error('duplicate account within same recent blockhash');
        }
        await cache.set(cacheKey, true);
        
        logger.info('VALIDATE_ACCOUNT_INIT', '✅ Account initialization validation completed successfully', accountContext);
        
    } catch (error) {
        logger.error('VALIDATE_ACCOUNT_INIT', 'Account initialization validation failed', context, error as Error);
        throw error;
    }
}
