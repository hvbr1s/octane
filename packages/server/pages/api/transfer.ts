import { sendAndConfirmRawTransaction, Transaction } from '@solana/web3.js';
import type { NextApiRequest, NextApiResponse } from 'next';
import base58 from 'bs58';
import { signWithTokenFee, core } from '@solana/octane-core';
import {
    cache,
    connection,
    ENV_SECRET_KEYPAIR,
    cors,
    rateLimit,
    isReturnedSignatureAllowed,
    ReturnSignatureConfigField,
} from '../../src';
import config from '../../../../config.json';

// Import logger from core
const { logger, TransactionLogger } = core;

// Endpoint to pay for transactions with an SPL token transfer
export default async function (request: NextApiRequest, response: NextApiResponse) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    logger.info('API_TRANSFER', '📡 Received transfer request', { txId: requestId });
    
    await cors(request, response);
    await rateLimit(request, response);

    // Deserialize a base58 wire-encoded transaction from the request
    const serialized = request.body?.transaction;
    if (typeof serialized !== 'string') {
        logger.error('API_TRANSFER', 'Invalid request: missing transaction', { txId: requestId }, new Error('request should contain transaction'));
        response.status(400).send({ status: 'error', message: 'request should contain transaction' });
        return;
    }

    logger.debug('API_TRANSFER', 'Deserializing transaction from base58', { txId: requestId });
    let transaction: Transaction;
    try {
        transaction = Transaction.from(base58.decode(serialized));
        logger.debug('API_TRANSFER', 'Transaction deserialized successfully', { txId: requestId });
    } catch (e) {
        logger.error('API_TRANSFER', 'Failed to decode transaction', { txId: requestId }, e as Error);
        response.status(400).send({ status: 'error', message: "can't decode transaction" });
        return;
    }

    try {
        const context = TransactionLogger.extractTransactionContext(transaction);
        logger.info('API_TRANSFER', '🚀 Starting token fee signing process', { ...context, txId: requestId });
        
        const { signature } = await signWithTokenFee(
            connection,
            transaction,
            ENV_SECRET_KEYPAIR,
            config.maxSignatures,
            config.lamportsPerSignature,
            config.endpoints.transfer.tokens.map((token) => core.TokenFee.fromSerializable(token)),
            cache
        );

        logger.info('API_TRANSFER', '✅ Transaction signed successfully', { ...context, txId: requestId, signature });

        if (config.returnSignature !== undefined) {
            logger.debug('API_TRANSFER', 'Checking anti-spam for signature return', { txId: requestId, signature });
            if (!await isReturnedSignatureAllowed(
                request,
                config.returnSignature as ReturnSignatureConfigField
            )) {
                logger.warn('API_TRANSFER', 'Anti-spam check failed', { txId: requestId, signature });
                response.status(400).send({ status: 'error', message: 'anti-spam check failed' });
                return;
            }
            logger.info('API_TRANSFER', '📤 Returning signature only (no broadcast)', { txId: requestId, signature });
            response.status(200).send({ status: 'ok', signature });
            return;
        }

        logger.debug('API_TRANSFER', 'Adding signature and broadcasting transaction', { txId: requestId, signature });
        transaction.addSignature(
            ENV_SECRET_KEYPAIR.publicKey,
            Buffer.from(base58.decode(signature))
        );

        await sendAndConfirmRawTransaction(
            connection,
            transaction.serialize(),
            {commitment: 'confirmed'}
        );

        logger.info('API_TRANSFER', '🎉 Transaction confirmed on network', { txId: requestId, signature });
        // Respond with the confirmed transaction signature
        response.status(200).send({ status: 'ok', signature });
    } catch (error) {
        let message = '';
        if (error instanceof Error) {
            message = error.message;
        }
        logger.error('API_TRANSFER', 'Transfer request failed', { txId: requestId }, error as Error);
        response.status(400).send({ status: 'error', message });
    }
}
