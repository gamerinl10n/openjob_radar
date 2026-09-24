export function createRequestLimiter(limit = 8) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new TypeError('동시 요청 수는 1 이상의 정수여야 합니다.');

  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < limit && queue.length) {
      const { task, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  };

  return (task) => {
    if (typeof task !== 'function')
      return Promise.reject(new TypeError('실행할 요청 함수가 필요합니다.'));
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      drain();
    });
  };
}
