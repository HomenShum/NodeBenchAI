/**
 * Re-export presence API from domains/auth/presence
 * This file exists for backward compatibility with frontend imports
 */
export {
  getUserId,
  heartbeat,
  list,
  disconnect,
} from "./domains/auth/presence";

