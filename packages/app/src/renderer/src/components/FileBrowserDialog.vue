<template>
  <n-config-provider :theme="themeStore.themeUI" :locale="zhCN" :date-locale="dateZhCN">
    <n-modal v-model:show="showModal" transform-origin="center" :auto-focus="false">
      <n-card style="width: 800px" title="文件浏览器" :bordered="false">
        <div class="file-browser-content">
          <!-- 文件扩展名筛选器 -->
          <!-- <div class="filter">
            <label for="extFilter">Filter by extension:</label>
            <select id="extFilter" v-model="selectedExt" @change="fetchFiles">
              <option value="">All</option>
              <option value=".txt">.txt</option>
              <option value=".pdf">.pdf</option>
              <option value=".jpg">.jpg</option>
            </select>
          </div> -->

          <!-- 当前路径显示 -->
          <div class="toolbar">
            <n-input
              v-model:value="currentPath"
              placeholder="请输入文件夹路径"
              @keyup.enter="openDirectory({ path: currentPath })"
            />
            <div class="toolbar-actions">
              <n-button quaternary @click="toggleManageMode">
                {{ manageMode ? "完成" : "管理" }}
              </n-button>
              <n-button
                v-if="manageMode"
                quaternary
                :disabled="!hasFileItems"
                @click="toggleSelectAll"
              >
                全选
              </n-button>
              <n-button
                v-if="manageMode"
                type="error"
                :disabled="!manageSelectedFiles.length || removing"
                @click="handleRemoveFiles(manageSelectedFiles)"
              >
                {{ removing ? "删除中..." : `删除(${manageSelectedFiles.length})` }}
              </n-button>
            </div>
          </div>

          <!-- 文件夹与文件展示 -->
          <ul class="file-list">
            <li v-if="currentPath && currentPath !== '/'" class="file" @click="goUpDirectory">
              <span class="file-name">📁 上一级</span>
            </li>
            <li
              v-for="file in files"
              :key="file.path"
              class="file"
              :class="{ selected: isRowSelected(file) }"
              @click="handleRowClick(file)"
            >
              <div class="file-main">
                <n-checkbox
                  v-if="manageMode && file.type === 'file'"
                  :checked="manageSelectedFiles.includes(file.path)"
                  @click.stop
                  @update:checked="toggleManageSelection(file.path, $event)"
                />
                <span class="file-name">
                  {{ file.type === "directory" ? "📁" : "📄" }} {{ file.name }}
                </span>
              </div>
              <div class="file-meta">
                <span v-if="showFileSize && file.type === 'file'" class="file-size">
                  {{ formatFileSize(file.size) }}
                </span>
                <n-button
                  v-if="manageMode && file.type === 'file'"
                  text
                  type="error"
                  @click.stop="handleRemoveFiles([file.path])"
                >
                  删除
                </n-button>
              </div>
            </li>
          </ul>
        </div>
        <template #footer>
          <div class="footer">
            <div class="footer-input">
              <n-input
                v-if="props.type === 'save'"
                v-model:value="filename"
                placeholder="请输入文件名"
                @keyup.enter="confirmSelection"
              >
                <template #suffix>
                  {{ props.extension ? `.${props.extension}` : "" }}
                </template>
              </n-input>
            </div>
            <div class="footer-actions">
              <n-button @click="closeDialog">取消</n-button>
              <n-button
                type="primary"
                style="margin-left: 10px"
                :disabled="!canConfirm || removing"
                @click="confirmSelection"
              >
                {{ confirmText }}
              </n-button>
            </div>
          </div>
        </template>
      </n-card>
    </n-modal>
  </n-config-provider>
</template>

<script lang="ts" setup>
import { commonApi } from "@renderer/apis";
import { useConfirm } from "@renderer/hooks";
import { useThemeStore } from "@renderer/stores/theme";
import { useStorage } from "@vueuse/core";
import { dateZhCN, zhCN } from "naive-ui";

interface Props {
  type?: "file" | "directory" | "save";
  multi?: boolean;
  exts?: string[];
  extension?: string;
  defaultPath?: string;
  close: () => void;
  confirm: (path: string[]) => void;
}

interface BrowserFileItem {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
}

const showModal = defineModel<boolean>("visible", { required: true, default: false });
// const emit = defineEmits(["close", "confirm"]);
const props = withDefaults(defineProps<Props>(), {
  type: "file",
  multi: false,
  extension: "",
  exts: () => [],
  defaultPath: "",
  close: () => {},
  confirm: () => {},
});

const files = ref<BrowserFileItem[]>([]);
// const currentPath = ref("/"); // 跟踪当前路径
const currentPath = useStorage("file-store", "/");
const filename = ref(""); // 跟踪当前文件名
// const selectedExt = ref<string[]>([]); // 跟踪当前选择的扩展名
const selectedFiles = ref<string[]>([]);
const manageMode = ref(false);
const manageSelectedFiles = ref<string[]>([]);
const removing = ref(false);
const parentPath = ref<string>();

const themeStore = useThemeStore();
const confirmDialog = useConfirm();
const notice = useNotification();

const confirmText = computed(() => {
  if (props.type === "directory") {
    return "选择文件夹";
  }
  if (props.type === "save") {
    return "保存";
  }
  if (props.type === "file") {
    return "打开";
  }
  return "确定";
});

const canConfirm = computed(() => {
  if (manageMode.value) {
    return false;
  }

  if (props.type === "directory") {
    return true;
  }
  if (props.type === "save") {
    return Boolean(filename.value.trim());
  }
  return selectedFiles.value.length > 0;
});

const showFileSize = computed(() => props.type === "file");
const fileItems = computed(() => files.value.filter((item) => item.type === "file"));
const hasFileItems = computed(() => fileItems.value.length > 0);
const isAllFilesSelected = computed(
  () =>
    hasFileItems.value &&
    fileItems.value.every((item) => manageSelectedFiles.value.includes(item.path)),
);

let runCount = 0;
// 获取文件列表
const fetchFiles = async () => {
  selectedFiles.value = [];
  const typeMap = {
    file: "file",
    directory: "directory",
    save: "directory",
  } as const;

  const res = await commonApi
    .getFiles({
      path: currentPath.value,
      exts: props.exts,
      type: typeMap[props.type],
    })
    .catch((err) => {
      runCount++;
      currentPath.value = "/";
      if (runCount > 4) {
        throw err;
      }
      fetchFiles();
      throw err;
    });

  runCount = 0;
  files.value = res.list;
  parentPath.value = res.parent;

  const availableFiles = new Set(
    res.list.filter((item) => item.type === "file").map((item) => item.path),
  );
  manageSelectedFiles.value = manageSelectedFiles.value.filter((item) => availableFiles.has(item));
};

// 优化文件大小显示
const formatFileSize = (size?: number) => {
  if (typeof size !== "number" || Number.isNaN(size) || size < 0) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

// 进入文件夹
const openDirectory = (file: { path: string }) => {
  currentPath.value = file.path;
  fetchFiles();
};

// 返回上一级目录
const goUpDirectory = () => {
  currentPath.value = parentPath.value || "/";
  fetchFiles();
};

// 选择文件
const selectFile = (file: BrowserFileItem) => {
  if (props.type === "file" && file.type === "directory") {
    openDirectory(file);
    return;
  }

  if (props.type !== file.type) {
    return;
  }

  if (props.multi) {
    if (selectedFiles.value.includes(file.path)) {
      selectedFiles.value = selectedFiles.value.filter((item) => item !== file.path);
    } else {
      selectedFiles.value = [...selectedFiles.value, file.path];
    }
    return;
  }

  selectedFiles.value = [file.path];
};

const toggleManageSelection = (path: string, checked?: boolean) => {
  const isChecked =
    typeof checked === "boolean" ? checked : !manageSelectedFiles.value.includes(path);

  if (isChecked) {
    manageSelectedFiles.value = [...new Set([...manageSelectedFiles.value, path])];
    return;
  }

  manageSelectedFiles.value = manageSelectedFiles.value.filter((item) => item !== path);
};

const handleRowClick = (file: BrowserFileItem) => {
  if (manageMode.value) {
    if (file.type === "directory") {
      openDirectory(file);
      return;
    }
    toggleManageSelection(file.path);
    return;
  }

  selectFile(file);
};

const isRowSelected = (file: BrowserFileItem) => {
  if (manageMode.value && file.type === "file") {
    return manageSelectedFiles.value.includes(file.path);
  }
  return selectedFiles.value.includes(file.path);
};

const toggleManageMode = () => {
  manageMode.value = !manageMode.value;
  manageSelectedFiles.value = [];
};

const toggleSelectAll = () => {
  if (isAllFilesSelected.value) {
    manageSelectedFiles.value = [];
    return;
  }
  manageSelectedFiles.value = fileItems.value.map((item) => item.path);
};

const getFailedSummary = (failed: { path: string; reason: string }[]) => {
  return failed
    .slice(0, 3)
    .map((item) => `${window.path.basename(item.path)}: ${item.reason}`)
    .join("；");
};

const handleRemoveFiles = async (paths: string[]) => {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return;
  }

  const [confirmed] = await confirmDialog.warning({
    title: uniquePaths.length > 1 ? "批量删除文件" : "删除文件",
    content:
      uniquePaths.length > 1
        ? `确定删除选中的 ${uniquePaths.length} 个文件吗？`
        : `确定删除文件“${window.path.basename(uniquePaths[0])}”吗？`,
    positiveText: "删除",
    negativeText: "取消",
  });

  if (!confirmed) {
    return;
  }

  removing.value = true;
  try {
    const result = await commonApi.removePaths(uniquePaths);
    await fetchFiles();

    if (result.failed.length === 0) {
      notice.success({
        title: "删除成功",
        content:
          result.success.length > 1
            ? `已删除 ${result.success.length} 个文件`
            : `${window.path.basename(result.success[0])} 已删除`,
        duration: 2000,
      });
      return;
    }

    if (result.success.length === 0) {
      notice.error({
        title: "删除失败",
        content: getFailedSummary(result.failed),
        duration: 3000,
      });
      return;
    }

    notice.warning({
      title: "部分删除失败",
      content: `成功 ${result.success.length} 个，失败 ${result.failed.length} 个。${getFailedSummary(result.failed)}`,
      duration: 3500,
    });
  } catch (error) {
    notice.error({
      title: "删除失败",
      content: error instanceof Error ? error.message : String(error),
      duration: 3000,
    });
  } finally {
    removing.value = false;
  }
};

// 关闭弹框
const closeDialog = () => {
  showModal.value = false;
  // emit("close");
  props.close();
};

const confirmSelection = async () => {
  if (manageMode.value) {
    return;
  }

  let result = selectedFiles.value;
  if (props.type === "directory" && !result.length) {
    result = [currentPath.value];
  } else if (props.type === "save") {
    if (!filename.value.trim()) {
      return;
    }
    const filePath = await commonApi.fileJoin(currentPath.value, filename.value.trim());
    result = [filePath + `.${props.extension}`];
  }

  showModal.value = false;
  // emit("confirm", { path: selectedFiles.value });
  props.confirm(result);
  // closeDialog();
};

// watch(
//   () => showModal.value,
//   () => {
//     filePath.value = currentPath.value;
//   },
// );

onMounted(() => {
  // 默认路径可能是文件名，也有可能是绝对路径文件名
  if (props.defaultPath) {
    if (window.path.isAbsolute(props.defaultPath)) {
      currentPath.value = window.path.dirname(props.defaultPath);
    }

    // 文件名
    filename.value = window.path.basename(props.defaultPath, window.path.extname(props.defaultPath));
  }

  fetchFiles();
});
</script>

<style scoped lang="less">
.filter {
  margin-bottom: 10px;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.file-list {
  list-style-type: none;
  padding: 0;
  margin: 20px 0;
}

.file-list li {
  padding: 10px;
  cursor: pointer;
  margin-bottom: 5px;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &.selected {
    // 选中颜色更深一点
    background-color: var(--bg-hover);
  }
  // border-bottom: 1px solid #ddd;
}

.file-list li:hover {
  &:hover {
  background-color: var(--bg-hover);
  }
}

.file-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.file-size {
  flex: none;
  color: var(--text-color-3);
  font-variant-numeric: tabular-nums;
}

.file-actions {
  display: flex;
  justify-content: flex-end;
}

.footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.footer-input {
  flex: 1;
}

.footer-actions {
  flex: none;
}

button {
  margin-left: 10px;
}
</style>
