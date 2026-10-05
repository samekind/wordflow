const key = 'wordflow.tutorialSeen'
/** Device-local flag: the usage tutorial pops once after first-run setup, and can always be
 * reopened from 我的 → 使用教程. */
export const tutorialSeen = () => localStorage.getItem(key) === '1'
export const markTutorialSeen = () => localStorage.setItem(key, '1')
