const key = 'wordflow.skipKnownConfirm'
/** Whether 设为熟词 goes through without asking. Per device; the toast still offers 撤销. */
export function skipKnownConfirm() {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
export function setSkipKnownConfirm(skip: boolean) {
  try { localStorage.setItem(key, skip ? '1' : '0') } catch { /* The choice just is not remembered. */ }
}
