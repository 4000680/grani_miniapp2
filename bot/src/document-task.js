// Keep PDF I/O below the 30-second lifetime of webhook background work.
export function createDocumentTask(budgetMs = 18000) {
  const expiresAt = Date.now() + budgetMs;
  return {
    async run(stage, operation, maxMs = budgetMs) {
      const remaining = Math.min(maxMs, expiresAt - Date.now());
      const controller = new AbortController();
      const failure = () => Object.assign(new Error(`Превышено время ожидания: ${stage}. Повторите загрузку или обратитесь в поддержку`), {
        code: 'DOCUMENT_TIMEOUT', documentStage: stage
      });
      if (remaining <= 0) throw failure();
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => operation(controller.signal)),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              // Reject with a useful stage before abort propagates a generic AbortError.
              reject(failure());
              controller.abort();
            }, remaining);
          })
        ]);
      } catch (error) {
        if (error && typeof error === 'object') error.documentStage ||= stage;
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
}
