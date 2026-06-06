export function openDateInputPicker(input: HTMLInputElement) {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };

  if (pickerInput.disabled || pickerInput.readOnly || typeof pickerInput.showPicker !== "function") {
    return;
  }

  try {
    pickerInput.showPicker();
  } catch {
    // Some browsers only allow showPicker during trusted pointer interactions.
  }
}
