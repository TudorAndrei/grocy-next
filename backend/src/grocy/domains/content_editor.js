window.initializeRichTextEditor = function ({ initial, locale, label, sourceLabel, channel }) {
  const $ = window.jQuery;
  const editor = $("#description");
  editor.val(initial);
  let initialized = false;

  function emit(kind) {
    const full = editor.summernote("fullscreen.isFullscreen");
    parent.postMessage(
      {
        channel,
        kind,
        html: kind === "ready" ? initial : editor.summernote("code"),
        empty: editor.summernote("isEmpty"),
        height: Math.max(360, Math.ceil(document.body.getBoundingClientRect().height)),
        fullscreen: full,
      },
      "*",
    );
  }

  function labelEditor() {
    $(".note-editable").attr({
      role: "textbox",
      "aria-label": label,
      "aria-multiline": "true",
    });
    $(".note-codable").attr({
      "aria-label": $.summernote.lang[locale]?.options?.codeview ?? sourceLabel,
    });
  }

  editor.summernote({
    minHeight: "300px",
    lang: locale,
    callbacks: {
      onInit() {
        labelEditor();
      },
      onChange() {
        if (initialized) emit("change");
      },
      onImageLinkInsert(url) {
        const img = $("<img>").attr({ src: url, class: "img-fluid", loading: "lazy" });
        editor.summernote("insertNode", img[0]);
      },
    },
    toolbar: [
      ["fontsize", ["fontsize"]],
      ["font", ["bold", "underline", "clear"]],
      ["color", ["color"]],
      ["para", ["ul", "ol", "paragraph"]],
      ["table", ["table"]],
      ["insert", ["link", "picture", "video"]],
      ["view", ["codeview", "fullscreen"]],
    ],
  });
  $(".note-video-clip").each(function () {
    $(this)
      .parent()
      .html(
        '<div class="embed-responsive embed-responsive-16by9">' +
          $(this).wrap("<p/>").parent().html() +
          "</div>",
      );
  });
  initialized = true;
  new ResizeObserver(() => emit("resize")).observe(document.body);
  new MutationObserver(() => {
    const full = editor.summernote("fullscreen.isFullscreen");
    if (full !== lastFullscreen) {
      lastFullscreen = full;
      emit("resize");
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  let lastFullscreen = false;
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    if (event.data.command === "appearance") {
      document.body.classList.toggle("night-mode", event.data.dark === true);
      document.documentElement.dir = event.data.direction === "rtl" ? "rtl" : "ltr";
    }
    if (event.data.command === "clear") {
      initialized = false;
      editor.summernote("reset");
      initialized = true;
      labelEditor();
      emit("clear");
    }
    if (event.data.command === "leave-fullscreen" && editor.summernote("fullscreen.isFullscreen")) {
      editor.summernote("fullscreen.toggle");
    }
    if (event.data.command === "focus") editor.summernote("focus");
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Tab" &&
      editor.summernote("fullscreen.isFullscreen") &&
      !$(".modal.show").length
    ) {
      const controls = $(
        "button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),textarea:not(:disabled),select:not(:disabled),[contenteditable=true]",
      )
        .filter(":visible")
        .toArray();
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        emit("focus-back");
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        emit("focus-forward");
      }
    }
    if (
      event.key === "Escape" &&
      editor.summernote("fullscreen.isFullscreen") &&
      !editor.summernote("codeview.isActivated") &&
      !$(".modal.show").length
    ) {
      event.preventDefault();
      editor.summernote("fullscreen.toggle");
    }
  });
  emit("ready");
};
