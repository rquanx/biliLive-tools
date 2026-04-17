import { App, createApp, defineComponent, h } from "vue";
import { NDialogProvider, NNotificationProvider } from "naive-ui";
import FileBrowserDialog from "./FileBrowserDialog.vue";

export default async function showDirectoryDialog(
  options: {
    type?: "file" | "directory" | "save";
    multi?: boolean;
    exts?: string[];
    extension?: string;
    defaultPath?: string;
  } = {},
): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const mountNode = document.createElement("div");
    const cleanup = () => {
      if (dialogApp) {
        dialogApp.unmount();
        document.body.removeChild(mountNode);
        dialogApp = undefined;
      }
    };

    const dialogProps = {
      visible: true,
      ...options,
      close: () => {
        cleanup();
        resolve(undefined);
      },
      confirm: (path: string[]) => {
        cleanup();
        resolve(path);
      },
    };

    const Root = defineComponent({
      name: "FileBrowserDialogRoot",
      setup() {
        return () =>
          h(NDialogProvider, null, {
            default: () =>
              h(NNotificationProvider, null, {
                default: () => h(FileBrowserDialog, dialogProps),
              }),
          });
      },
    });

    let dialogApp: App<Element> | undefined = createApp(Root);
    document.body.appendChild(mountNode);
    dialogApp.mount(mountNode);
  });
}
