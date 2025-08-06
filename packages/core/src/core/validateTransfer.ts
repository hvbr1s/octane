import {
    DecodedTransferCheckedInstruction,
    DecodedTransferInstruction,
    decodeInstruction,
    getAccount,
    isTransferCheckedInstruction,
    isTransferInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Connection, Transaction } from '@solana/web3.js';
import { TokenFee } from './tokenFee';
import { logger, TransactionLogger } from './logger';

// Check that a transaction contains a valid transfer to Octane's token account
export async function validateTransfer(
    connection: Connection,
    transaction: Transaction,
    allowedTokens: TokenFee[]
): Promise<DecodedTransferInstruction | DecodedTransferCheckedInstruction> {
    const context = TransactionLogger.extractTransactionContext(transaction);
    logger.info('VALIDATE_TRANSFER', '💸 Starting transfer validation', context);
    
    try {
        // Get the first instruction of the transaction
        logger.debug('VALIDATE_TRANSFER', 'Finding first Token Program instruction', context);
        
        const tokenInstruction = transaction.instructions.find(
            ix => ix.programId.equals(TOKEN_PROGRAM_ID)
        );
        
        if (!tokenInstruction) {
            logger.error('VALIDATE_TRANSFER', 'No Token Program instructions found in transaction', context, new Error('missing token instruction'));
            throw new Error('missing token instruction');
        }
        
        // Log which instruction index we're using
        const instructionIndex = transaction.instructions.indexOf(tokenInstruction);
        logger.debug('VALIDATE_TRANSFER', `Found Token Program instruction at index ${instructionIndex}`, context);

        // Decode the Token Program instruction
        logger.debug('VALIDATE_TRANSFER', 'Decoding SPL token instruction', context);
        const instruction = decodeInstruction(tokenInstruction);
        if (!(isTransferInstruction(instruction) || isTransferCheckedInstruction(instruction))) {
            logger.error('VALIDATE_TRANSFER', 'First instruction is not a valid SPL transfer', context, new Error('invalid instruction'));
            throw new Error('invalid instruction');
        }
        
        const instructionType = isTransferInstruction(instruction) ? 'Transfer' : 'TransferChecked';
        logger.debug('VALIDATE_TRANSFER', `✅ Valid ${instructionType} instruction found`, context);

        const {
            keys: { source, destination, owner },
            data: { amount },
        } = instruction;
        
        const transferContext = {
            ...context,
            source: source.pubkey.toBase58(),
            destination: destination.pubkey.toBase58(),
            amount: amount.toString()
        };
        
        logger.debug('VALIDATE_TRANSFER', 'Validating source account', transferContext);

        // Check that the source account exists, has the correct owner, is not frozen, and has enough funds
        const account = await getAccount(connection, source.pubkey, 'confirmed');
        if (!account.owner.equals(owner.pubkey)) {
            logger.error('VALIDATE_TRANSFER', 'Source account owner mismatch', transferContext, new Error('source invalid owner'));
            throw new Error('source invalid owner');
        }
        if (account.isFrozen) {
            logger.error('VALIDATE_TRANSFER', 'Source account is frozen', transferContext, new Error('source frozen'));
            throw new Error('source frozen');
        }
        if (account.amount < amount) {
            logger.error('VALIDATE_TRANSFER', `Insufficient balance: ${account.amount} < ${amount}`, transferContext, new Error('source insufficient balance'));
            throw new Error('source insufficient balance');
        }
        
        logger.debug('VALIDATE_TRANSFER', `✅ Source account validation passed (balance: ${account.amount})`, transferContext);

        // Check that the source account's mint is one of the accepted tokens
        logger.debug('VALIDATE_TRANSFER', `Checking if mint ${account.mint.toBase58()} is in allowed tokens list`, transferContext);
        const token = allowedTokens.find((token) => token.mint.equals(account.mint));
        if (!token) {
            logger.error('VALIDATE_TRANSFER', `Token mint ${account.mint.toBase58()} not in allowed tokens list`, transferContext, new Error('invalid token'));
            throw new Error('invalid token');
        }
        
        const tokenContext = { ...transferContext, token: token.mint.toBase58() };
        logger.debug('VALIDATE_TRANSFER', `✅ Token found in allowed list (fee: ${token.fee})`, tokenContext);

        // Check that the instruction is going to pay the fee
        if (amount < token.fee) {
            logger.error('VALIDATE_TRANSFER', `Amount ${amount} is less than required fee ${token.fee}`, tokenContext, new Error('invalid amount'));
            throw new Error('invalid amount');
        }
        
        logger.debug('VALIDATE_TRANSFER', `✅ Amount validation passed (${amount} >= ${token.fee})`, tokenContext);

        // Check that the instruction has a valid source account
        logger.debug('VALIDATE_TRANSFER', 'Validating source account permissions', tokenContext);
        // if (!source.isWritable) {
        //     logger.error('VALIDATE_TRANSFER', 'Source account is not writable', tokenContext, new Error('source not writable'));
        //     throw new Error('source not writable');
        // }
        if (source.isSigner) {
            logger.error('VALIDATE_TRANSFER', 'Source account should not be a signer', tokenContext, new Error('source is signer'));
            throw new Error('source is signer');
        }
        
        logger.debug('VALIDATE_TRANSFER', '✅ Source account permissions validated', tokenContext);

        // Check that the destination account is Octane's and is valid
        logger.debug('VALIDATE_TRANSFER', `Validating destination account (expected: ${token.account.toBase58()})`, tokenContext);
        if (!destination.pubkey.equals(token.account)) {
            logger.error('VALIDATE_TRANSFER', `Invalid destination: ${destination.pubkey.toBase58()} != ${token.account.toBase58()}`, tokenContext, new Error('invalid destination'));
            throw new Error('invalid destination');
        }
        if (!destination.isWritable) {
            logger.error('VALIDATE_TRANSFER', 'Destination account is not writable', tokenContext, new Error('destination not writable'));
            throw new Error('destination not writable');
        }
        if (destination.isSigner) {
            logger.error('VALIDATE_TRANSFER', 'Destination account should not be a signer', tokenContext, new Error('destination is signer'));
            throw new Error('destination is signer');
        }
        
        logger.debug('VALIDATE_TRANSFER', '✅ Destination account validation passed', tokenContext);

        // Check that the owner of the source account is valid and has signed
        logger.debug('VALIDATE_TRANSFER', 'Validating owner signature', tokenContext);
        if (!owner.pubkey.equals(transaction.signatures[1].publicKey)) {
            logger.error('VALIDATE_TRANSFER', 'Owner signature missing or invalid', tokenContext, new Error('owner missing signature'));
            throw new Error('owner missing signature');
        }
        if (owner.isWritable) {
            logger.error('VALIDATE_TRANSFER', 'Owner account should not be writable', tokenContext, new Error('owner is writable'));
            throw new Error('owner is writable');
        }
        if (!owner.isSigner) {
            logger.error('VALIDATE_TRANSFER', 'Owner must be a signer', tokenContext, new Error('owner not signer'));
            throw new Error('owner not signer');
        }
        
        logger.debug('VALIDATE_TRANSFER', '✅ Owner signature validation passed', tokenContext);

        // If the instruction is a `TransferChecked` instruction, check that the mint and decimals are valid
        if (isTransferCheckedInstruction(instruction)) {
            logger.debug('VALIDATE_TRANSFER', 'Validating TransferChecked-specific fields', tokenContext);
            const {
                keys: { mint },
                data: { decimals },
            } = instruction;

            if (decimals !== token.decimals) {
                logger.error('VALIDATE_TRANSFER', `Invalid decimals: ${decimals} != ${token.decimals}`, tokenContext, new Error('invalid decimals'));
                throw new Error('invalid decimals');
            }

            if (!mint.pubkey.equals(token.mint)) {
                logger.error('VALIDATE_TRANSFER', `Invalid mint: ${mint.pubkey.toBase58()} != ${token.mint.toBase58()}`, tokenContext, new Error('invalid mint'));
                throw new Error('invalid mint');
            }
            if (mint.isWritable) {
                logger.error('VALIDATE_TRANSFER', 'Mint account should not be writable', tokenContext, new Error('mint is writable'));
                throw new Error('mint is writable');
            }
            if (mint.isSigner) {
                logger.error('VALIDATE_TRANSFER', 'Mint account should not be a signer', tokenContext, new Error('mint is signer'));
                throw new Error('mint is signer');
            }
            
            logger.debug('VALIDATE_TRANSFER', '✅ TransferChecked validation passed', tokenContext);
        }
        
        logger.info('VALIDATE_TRANSFER', '✅ Transfer validation completed successfully', tokenContext);
        return instruction;
        
    } catch (error) {
        logger.error('VALIDATE_TRANSFER', 'Transfer validation failed', context, error as Error);
        throw error;
    }
}
