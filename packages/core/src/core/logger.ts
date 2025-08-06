import { Transaction, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';

export interface TransactionContext {
    txId?: string;
    signature?: string;
    feePayer?: string;
    instructionCount?: number;
    blockhash?: string;
    source?: string;
    destination?: string;
    amount?: string;
    token?: string;
    computeUnitsConsumed?: string;
    associatedToken?: string;
    owner?: string;
}

export class TransactionLogger {
    private static instance: TransactionLogger;
    private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';

    private constructor() {}

    public static getInstance(): TransactionLogger {
        if (!TransactionLogger.instance) {
            TransactionLogger.instance = new TransactionLogger();
        }
        return TransactionLogger.instance;
    }

    public setLogLevel(level: 'debug' | 'info' | 'warn' | 'error') {
        this.logLevel = level;
    }

    private shouldLog(level: string): boolean {
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(this.logLevel);
    }

    private formatContext(context: TransactionContext): string {
        const parts: string[] = [];
        if (context.txId) parts.push(`txId=${context.txId.slice(0, 8)}...`);
        if (context.signature) parts.push(`sig=${context.signature.slice(0, 8)}...`);
        if (context.feePayer) parts.push(`feePayer=${context.feePayer.slice(0, 8)}...`);
        if (context.instructionCount) parts.push(`instructions=${context.instructionCount}`);
        if (context.blockhash) parts.push(`blockhash=${context.blockhash.slice(0, 8)}...`);
        if (context.source) parts.push(`source=${context.source.slice(0, 8)}...`);
        if (context.destination) parts.push(`dest=${context.destination.slice(0, 8)}...`);
        if (context.amount) parts.push(`amount=${context.amount}`);
        if (context.token) parts.push(`token=${context.token.slice(0, 8)}...`);
        if (context.computeUnitsConsumed) parts.push(`computeUnits=${context.computeUnitsConsumed}`);
        if (context.associatedToken) parts.push(`associatedToken=${context.associatedToken.slice(0, 8)}...`);
        if (context.owner) parts.push(`owner=${context.owner.slice(0, 8)}...`);
        
        return parts.length > 0 ? `[${parts.join(', ')}]` : '';
    }

    private log(level: string, stage: string, message: string, context?: TransactionContext, error?: Error) {
        if (!this.shouldLog(level)) return;

        const timestamp = new Date().toISOString();
        const contextStr = context ? this.formatContext(context) : '';
        const errorStr = error ? ` | Error: ${error.message}` : '';
        
        console.log(`[${timestamp}] [${level.toUpperCase()}] [${stage}] ${message} ${contextStr}${errorStr}`);
        
        if (error && level === 'error') {
            console.error(error.stack);
        }
    }

    public debug(stage: string, message: string, context?: TransactionContext) {
        this.log('debug', stage, message, context);
    }

    public info(stage: string, message: string, context?: TransactionContext) {
        this.log('info', stage, message, context);
    }

    public warn(stage: string, message: string, context?: TransactionContext, error?: Error) {
        this.log('warn', stage, message, context, error);
    }

    public error(stage: string, message: string, context?: TransactionContext, error?: Error) {
        this.log('error', stage, message, context, error);
    }

    // Helper method to extract context from transaction
    public static extractTransactionContext(transaction: Transaction, additionalContext?: Partial<TransactionContext>): TransactionContext {
        const context: TransactionContext = {
            feePayer: transaction.feePayer?.toBase58(),
            instructionCount: transaction.instructions.length,
            blockhash: transaction.recentBlockhash || undefined,
            ...additionalContext
        };

        // Generate a transaction ID from the message for tracking
        try {
            const messageBytes = transaction.serializeMessage();
            const txId = base58.encode(messageBytes.slice(0, 32)); // Use first 32 bytes as ID
            context.txId = txId;
        } catch (error) {
            // Ignore serialization errors for context extraction
        }

        return context;
    }

    // Helper method to create a transaction journey tracker
    public createJourneyTracker(initialContext: TransactionContext) {
        const startTime = Date.now();
        const journeyId = `journey_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        this.info('JOURNEY_START', `🚀 Starting transaction processing journey`, {
            ...initialContext,
            txId: journeyId
        });

        return {
            journeyId,
            startTime,
            stage: (stageName: string, message: string, context?: Partial<TransactionContext>) => {
                this.info('JOURNEY_STAGE', `📍 ${stageName}: ${message}`, {
                    ...initialContext,
                    ...context,
                    txId: journeyId
                });
            },
            complete: (finalContext?: Partial<TransactionContext>) => {
                const duration = Date.now() - startTime;
                this.info('JOURNEY_COMPLETE', `✅ Transaction processing completed in ${duration}ms`, {
                    ...initialContext,
                    ...finalContext,
                    txId: journeyId
                });
            },
            fail: (error: Error, context?: Partial<TransactionContext>) => {
                const duration = Date.now() - startTime;
                this.error('JOURNEY_FAILED', `❌ Transaction processing failed after ${duration}ms`, {
                    ...initialContext,
                    ...context,
                    txId: journeyId
                }, error);
            }
        };
    }
}

// Export singleton instance
export const logger = TransactionLogger.getInstance();