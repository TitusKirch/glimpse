<script setup lang="ts">
const repo = useRepoStore()
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="tab in repo.tabs"
      :key="tab.id"
      class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors"
      :class="
        tab.id === repo.activeTabId
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50'
      "
      @click="repo.selectTab(tab.id)"
    >
      <span>{{ tab.name }}</span>
      <UiBadge
        v-if="tab.flavor === 'wsl'"
        variant="secondary"
        class="text-[10px] uppercase"
      >
        {{ tab.distro || 'WSL' }}
      </UiBadge>
    </button>
  </div>
</template>
