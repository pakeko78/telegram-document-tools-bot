export function safeErr(e) {
  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    String(e)
  );
}
