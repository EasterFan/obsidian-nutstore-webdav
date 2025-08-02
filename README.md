# WebDAV Image Uploader

This is an Obsidian (https://obsidian.md) plugin for managing local images by storing them on WebDAV server, and previewing them via links (`![]()`):

![sample](./assets/sample.gif)

## Features

### Upload, Download, and Delete Files

- When pasting or dragging images into a note, the plugin will intercept the action, upload the image to the WebDAV server according to the configured path format (Plugin Settings -> Basic -> Path Format), and then insert a preview link for the image (`![file](https://yourdomain.com/dav/path/to/file.jpg)`). You can enable/disable it in the plugin settings, or execute `WebDAV Manager: Toggle auto upload` command.
- You can also right-click on a local image link (`![file](attachments/file.jpg)`) and select the `Upload file to WebDAV` option from the menu to upload the image and insert the link. You can configure whether to keep the local file after a successful upload.
- When right-clicking a preview link, you can select `Download file from WebDAV` to download the image locally. The path is related to your Obsidian configuration (Settings -> Files & Links).
- When right-clicking a preview link, you can select `Delete file from WebDAV` to delete the image from the WebDAV server and remove the link from the note.

### Batch Upload/Download

In the Plugin Settings -> Commands, some buttons are provided for batch uploading and downloading images:

- Read all notes in the vault, and upload all local images (`![file](attachments/file.jpg)`) to the WebDAV server.
- Read all notes in the vault, and download all remote images (`![file](https://yourdomain.com/dav/...)`) to locally.

**Note: These features have not been thoroughly tested (only run once in my vault). Please be sure to back up your vault before running them to prevent damage due to bugs.**

## Others

### About Image Preview

WebDAV may require [Http Authentication](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication) to verify permissions when accessing files. But Obsidian (CodeMirror) does not seem to provide an API to add request headers for requests sent by `![]()`. Therefore, this plugin manually fetching and displaying the images. This display behavior differs from Obsidian's default behavior and may result in loading failures (in rare cases), and it doesn't work in other cases (like reading mode or [image properties](https://help.obsidian.md/bases/views#Image+property)).

I've tried to solve this problem by various methods within Obsidian, but none of them have worked well so far. If you don't like this feature, you can disable it in the plugin settings (and restart Obsidian), then configure your server to allow image access (or simply disable authentication). For example, you can add the following configuration to your Nginx server to add headers for requests from Obsidian:

```nginx
# Obsidian will send requests with user-agent containing "obsidian/x.x.x"
map $http_user_agent $obsidian_header {
    default 0;
    "~*obsidian" "Basic {TOKEN}";
}

server {
    # ...
    location /dav/obsidian {
        # ...
        proxy_set_header Authorization $obsidian_header;
    }
}
```

You can generate the token by encoding `username:password` in base64 format (`echo -n "username:password" | base64`).

If you have a better solution, pull requests are welcome.

### About This Plugin

This plugin was primarily written for my personal use to replace the [image-auto-upload](https://github.com/renmu123/obsidian-image-auto-upload-plugin) plugin, due to it requires running an additional `PicGo` locally, and it does not offer a feature to upload images for the entire vault (I have thousands of notes needs to process).

After trying my plugin out for a few days, I feel that it already meets my needs: uploading all images to WebDAV (even though it only ran once), and then easily uploading and downloading images within notes (with the ability to conveniently delete them when something goes wrong).

## Inspired by

[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)
