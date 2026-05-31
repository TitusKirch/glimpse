// Shared open state for the add-remote dialog (name + url).
const open = ref(false);

export function useRemoteDialog() {
  return {
    open,
    show: () => {
      open.value = true;
    }
  };
}
