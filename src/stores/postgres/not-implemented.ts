export const notImplemented = (methodName: string): Promise<never> =>
    Promise.reject(new Error(`${methodName} is not implemented yet`));
