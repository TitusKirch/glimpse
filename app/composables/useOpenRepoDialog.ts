// Shared open state for the "open repository" dialog (recent list + picker).
const open = ref(false);

export function useOpenRepoDialog() {
  return {
    open,
    show: () => {
      open.value = true;
    },
    hide: () => {
      open.value = false;
    }
  };
}
