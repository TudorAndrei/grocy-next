type UiSound = "silence" | "success" | "error" | "barcodescannerbeep";

export function playUiSound(sound: UiSound) {
  void new Audio(`${import.meta.env.BASE_URL}uisounds/${sound}.mp3`).play();
}
