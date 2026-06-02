<script setup lang="ts">
// Shared file list, used by the Changes panel and the commit file list in the
// diff. Renders either a flat list (`view: 'list'`) or a grouped, collapsible
// folder tree (`view: 'tree'`) — VS-Code-style, with single-child folder
// chains compacted into one row.

interface FileItem {
  path: string;
  status: string;
  [key: string]: unknown;
}

const props = defineProps<{
  files: FileItem[];
  view: 'list' | 'tree';
  selected?: string | null;
}>();

const emit = defineEmits<{ select: [path: string] }>();

interface TreeFile {
  type: 'file';
  name: string;
  file: FileItem;
}
interface TreeDir {
  type: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = TreeFile | TreeDir;

function buildDir({ name, path }: { name: string; path: string }): TreeDir {
  return { type: 'dir', name, path, children: [] };
}

// Build a nested folder tree from the flat list of file paths.
function buildTree(files: FileItem[]): TreeDir {
  const root = buildDir({ name: '', path: '' });
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const childPath = node.path ? `${node.path}/${part}` : part;
      let dir = node.children.find(
        (c): c is TreeDir => c.type === 'dir' && c.path === childPath
      );
      if (!dir) {
        dir = buildDir({ name: part, path: childPath });
        node.children.push(dir);
      }
      node = dir;
    }
    node.children.push({ type: 'file', name: parts.at(-1)!, file: f });
  }
  return root;
}

// Collapse "a → b → c" chains (folders with a single sub-folder) into one row.
function compactDir(dir: TreeDir): TreeDir {
  let current: TreeDir = {
    ...dir,
    children: dir.children.map((c) => (c.type === 'dir' ? compactDir(c) : c))
  };
  while (current.children.length === 1 && current.children[0]!.type === 'dir') {
    const only = current.children[0] as TreeDir;
    current = {
      type: 'dir',
      name: `${current.name}/${only.name}`,
      path: only.path,
      children: only.children
    };
  }
  return current;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const tree = computed(() => {
  const root = buildTree(props.files);
  root.children = root.children.map((c) =>
    c.type === 'dir' ? compactDir(c) : c
  );
  return root;
});

// Folders the user has collapsed (kept locally, by full path).
const collapsed = ref(new Set<string>());
function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

type Row =
  | { kind: 'dir'; name: string; path: string; depth: number }
  | { kind: 'file'; name: string; file: FileItem; depth: number };

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of sortNodes(nodes)) {
      if (n.type === 'dir') {
        out.push({ kind: 'dir', name: n.name, path: n.path, depth });
        if (!collapsed.value.has(n.path)) walk(n.children, depth + 1);
      } else {
        out.push({ kind: 'file', name: n.name, file: n.file, depth });
      }
    }
  };
  walk(tree.value.children, 0);
  return out;
});
</script>

<template>
  <!-- flat list -->
  <template v-if="view === 'list'">
    <FileRow
      v-for="f in files"
      :key="f.path"
      :path="f.path"
      :status="f.status"
      :active="selected === f.path"
      @select="emit('select', f.path)"
    >
      <template #actions>
        <slot name="actions" :file="f" />
      </template>
    </FileRow>
  </template>

  <!-- grouped folder tree -->
  <template v-else>
    <template
      v-for="r in rows"
      :key="r.kind === 'dir' ? `d:${r.path}` : r.file.path"
    >
      <div
        v-if="r.kind === 'dir'"
        role="button"
        tabindex="0"
        class="flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-2 text-left text-muted-foreground transition-colors hover:bg-accent/60"
        :style="{ paddingLeft: `${0.5 + r.depth * 0.75}rem` }"
        @click="toggle(r.path)"
        @keydown.enter="toggle(r.path)"
      >
        <NuxtIcon
          :name="
            collapsed.has(r.path)
              ? 'lucide:chevron-right'
              : 'lucide:chevron-down'
          "
          class="size-3.5 shrink-0"
        />
        <NuxtIcon name="lucide:folder" class="size-3.5 shrink-0" />
        <span class="truncate">{{ r.name }}</span>
      </div>
      <FileRow
        v-else
        :path="r.file.path"
        :status="r.file.status"
        :active="selected === r.file.path"
        name-only
        :depth="r.depth"
        @select="emit('select', r.file.path)"
      >
        <template #actions>
          <slot name="actions" :file="r.file" />
        </template>
      </FileRow>
    </template>
  </template>
</template>
