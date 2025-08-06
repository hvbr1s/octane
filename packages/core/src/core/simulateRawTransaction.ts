import { Connection, PublicKey, SimulatedTransactionResponse, Transaction } from '@solana/web3.js';
import { logger } from './logger';

// Simulate a signed, serialized transaction before broadcasting
export async function simulateRawTransaction(
    connection: Connection,
    rawTransaction: Buffer,
    includeAccounts?: boolean | Array<PublicKey>
): Promise<SimulatedTransactionResponse> {
    const context = { txId: `sim_${Date.now()}` };
    logger.info('SIMULATE_TRANSACTION', '🧪 Starting transaction simulation', context);
    
    try {
        /*
           Simulating a transaction directly can cause the `signatures` property to change.
           Possibly related:
           https://github.com/solana-labs/solana/issues/21722
           https://github.com/solana-labs/solana/pull/21724
           https://github.com/solana-labs/solana/issues/20743
           https://github.com/solana-labs/solana/issues/22021

           Clone it from the bytes instead, and make sure it's likely to succeed before paying for it.

           Within simulateTransaction there is a "transaction instanceof Transaction" check. Since connection is passed
           from outside the library, it uses parent application's version of web3.js. "instanceof" won't recognize a match.
           Instead, let's explicitly call for simulateTransaction within the dependency of the library.
         */
        logger.debug('SIMULATE_TRANSACTION', 'Deserializing transaction from raw bytes', context);
        const transaction = Transaction.from(rawTransaction);
        
        logger.debug('SIMULATE_TRANSACTION', 'Calling simulation on network', context);
        const simulated = await Connection.prototype.simulateTransaction.call(
            connection,
            transaction,
            undefined,
            includeAccounts
        );
        
        if (simulated.value.err) {
            logger.error('SIMULATE_TRANSACTION', `Simulation failed: ${JSON.stringify(simulated.value.err)}`, context, new Error('Simulation error'));
            throw new Error('Simulation error');
        }

        logger.info('SIMULATE_TRANSACTION', '✅ Transaction simulation completed successfully', {
            ...context,
            computeUnitsConsumed: simulated.value.unitsConsumed?.toString()
        });
        
        return simulated.value;
        
    } catch (error) {
        logger.error('SIMULATE_TRANSACTION', 'Transaction simulation failed', context, error as Error);
        throw error;
    }
}
