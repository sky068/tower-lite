export function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  if (absoluteSeconds < 60) {
    return "刚刚";
  }

  if (absoluteSeconds < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute");
  }

  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour");
  }

  if (absoluteSeconds < 604_800) {
    return formatter.format(Math.round(diffSeconds / 86_400), "day");
  }

  return new Date(value).toLocaleDateString();
}

export function formatCalendarDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDate - startOfToday) / 86_400_000);

  if (diffDays === 0) {
    return "今天";
  }

  if (diffDays === -1) {
    return "昨天";
  }

  return date.toLocaleDateString();
}
