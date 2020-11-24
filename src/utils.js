exports.wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.waitReject = (ms) => {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      reject();
    }, ms)
  );
};

exports.waitResolveReturn = (ms, returnValue) => {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(returnValue);
    }, ms)
  );
};

/* Test functions and code snippets */

/*
async function makeProgress() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let i = 0;
  for (i = 0; i <= 100; i++) {
    setProgressBarPercent(i.toString());
    await wait(50);
  }
}
*/
