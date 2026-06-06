import { getApiErrorMessage, getApiErrorMeta } from "../../lib/api";

export function MutationError({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }

  const meta = getApiErrorMeta(error);

  return (
    <div className="form-error">
      <span>{getApiErrorMessage(error)}</span>
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}
