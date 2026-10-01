import { useCallback, useState } from 'react'

/** One app-wide toast; `allowUndo` adds the 撤销 button when an undo is available. */
export function useToast() {
  const [message, setMessage] = useState('')
  const [allowUndo, setAllowUndo] = useState(false)
  const notify = useCallback((text: string, undo = false) => { setAllowUndo(undo); setMessage(text) }, [])
  const clear = useCallback(() => setMessage(''), [])
  return { message, allowUndo, notify, clear }
}
