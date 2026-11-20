export function createAudioFrameBudget(now: () => number = () => performance.now()) {
  const burst = 10;
  let credit = burst, previous = now();
  return () => {
    const time = now();
    credit = Math.min(burst, credit + Math.max(0, time - previous) * .052);
    previous = time;
    if (credit < 1) return false;
    credit--;
    return true;
  };
}
