export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="error-state" role="alert">
      {message}
    </div>
  );
}
