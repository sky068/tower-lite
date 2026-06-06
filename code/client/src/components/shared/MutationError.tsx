import { getApiErrorMessage } from "../../lib/api";

export function MutationError({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }

  return <div className="form-error">{getApiErrorMessage(error)}</div>;
}
