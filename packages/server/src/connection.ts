import { Connection } from '@solana/web3.js';
import config from '../../../config.json';
import { ENV_RPC_URL } from './env';

// Use RPC_URL from environment variable, fallback to config.json
const rpcUrl = ENV_RPC_URL || config.rpcUrl.trim();

export const connection = new Connection(rpcUrl, 'confirmed');
