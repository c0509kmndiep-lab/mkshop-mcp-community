// Timestamped console logging shared across the stack so every line is correlatable by wall-clock time.
const stamp = () => new Date().toISOString();
export const log = (...a) => console.log(`[${stamp()}]`, ...a);
export const logErr = (...a) => console.error(`[${stamp()}]`, ...a);
