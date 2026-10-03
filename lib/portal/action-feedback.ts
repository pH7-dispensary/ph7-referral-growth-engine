export type ShareConfirmation = "copy" | "share-copy" | "share";

/** UI feedback only. Latest completion wins; repeated clicks renew the hold. */
export function createActionFeedback(update: (source: ShareConfirmation | null, message: string | null) => void) {
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function begin() {
    clearTimeout(timer);
    return ++request;
  }
  function current(id: number) { return id === request; }
  function confirm(id: number, source: ShareConfirmation, message: string) {
    if (!current(id)) return;
    clearTimeout(timer);
    update(source, message);
    timer = setTimeout(() => {
      if (current(id)) update(null, null);
    }, 2400);
  }
  function dispose() { begin(); }
  return { begin, current, confirm, dispose };
}
