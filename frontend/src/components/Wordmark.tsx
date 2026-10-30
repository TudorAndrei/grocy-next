import { Link } from "@tanstack/react-router";

export function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Grocy Next, Home">
      <span className="wordmark-name">Grocy Next</span>
      <span className="wordmark-sub">Household</span>
    </Link>
  );
}
