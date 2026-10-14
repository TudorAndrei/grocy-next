import { Link } from "@tanstack/react-router";

export function Wordmark() {
  return (
    <Link to="/products" className="wordmark" aria-label="Grocy Next home">
      Grocy <span>Next</span>
    </Link>
  );
}
