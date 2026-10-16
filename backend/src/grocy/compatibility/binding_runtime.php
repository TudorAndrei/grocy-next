<?php

// Materialize PDO's text bindings without passing PHP strings through JSON.
class NativeBindings
{
    private const TOKENS = <<<'SQL'
~ '(?:[^']++|'')*+' | "(?:[^"]++|"")*+" | `(?:[^`]++|``)*+` | \[[^\]]*+\]
| --[^\n]* | /\*.*?\*/
| (?<parameter> \?[0-9]* | [:@][a-zA-Z0-9_\x80-\xff]+
    | \$[a-zA-Z0-9_\x80-\xff]+(?:::[a-zA-Z0-9_\x80-\xff]+)*(?:\([^)]*\))? )
~sx
SQL;

    private array $tokens;
    private array $names;
    private array $values;
    private ?PDOStatement $probe = null;

    public function __construct(private PDO $schema, private string $sql)
    {
        [$this->tokens, $this->names, $count] = self::parameters($sql);
        $this->values = array_fill(1, $count, 'NULL');
    }

    private static function parameters(string $sql): array
    {
        preg_match_all(self::TOKENS, $sql, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE | PREG_UNMATCHED_AS_NULL);
        $tokens = $names = [];
        $last = 0;
        foreach ($matches as $match) {
            [$name, $offset] = $match['parameter'];
            if ($name === null) continue;
            if ($name[0] === '?') {
                $index = strlen($name) === 1 ? $last + 1 : (int)substr($name, 1);
                if (strlen($name) > 1) $names[$name] = $index;
            } else {
                $index = $names[$name] ?? $last + 1;
                $names[$name] = $index;
            }
            $last = max($last, $index);
            $tokens[] = [$offset, strlen($name), $index];
        }
        return [$tokens, $names, $last];
    }

    public function execute(?array $parameters): string
    {
        if ($this->tokens === [] && empty($parameters)) return $this->sql;
        $this->probe ??= $this->schema->prepare('EXPLAIN ' . $this->sql);
        // EXPLAIN binds through the real PDO driver but never executes writes.
        // The driver retains its native unknown-name and extra-binding errors.
        $this->probe->execute($parameters);
        $this->probe->closeCursor();
        foreach ($parameters ?? [] as $key => $value) {
            $index = is_int($key) ? $key + 1 : $this->names[str_starts_with($key, ':') ? $key : ':' . $key];
            if ($value === null) {
                $this->values[$index] = 'NULL';
            } else {
                // execute(array) uses PDO::PARAM_STR, including for arrays and floats.
                $text = (string)$value;
                $this->values[$index] = str_contains($text, "\0") || !mb_check_encoding($text, 'UTF-8')
                    // Unary plus removes CAST's affinity while retaining its text value.
                    ? "(+CAST(X'" . bin2hex($text) . "' AS TEXT))"
                    : $this->schema->quote($text);
            }
        }
        return $this->render($this->sql, $this->tokens);
    }

    public function renderRelated(string $sql): string
    {
        [$tokens] = self::parameters($sql);
        return $this->render($sql, $tokens);
    }

    private function render(string $sql, array $tokens): string
    {
        $output = '';
        $position = 0;
        foreach ($tokens as [$offset, $length, $index]) {
            $output .= substr($sql, $position, $offset - $position) . $this->values[$index];
            $position = $offset + $length;
        }
        return $output . substr($sql, $position);
    }
}
