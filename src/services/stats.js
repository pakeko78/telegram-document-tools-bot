const bootStats = {
  conversionsCompleted: 0,
  mergesCompleted: 0
};

export function incConversionsCompleted() {
  bootStats.conversionsCompleted += 1;
}

export function incMergesCompleted() {
  bootStats.mergesCompleted += 1;
}

export function getBootStats() {
  return { ...bootStats };
}
