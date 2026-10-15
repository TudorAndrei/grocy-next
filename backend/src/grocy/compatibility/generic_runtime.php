<?php

// Execute Grocy 4.5.0's pinned LessQL against the application's SQLite connection.
// The private schema checks native column names before local extensions can affect SQL.
class NativeDatabase extends LessQL\Database
{
    public string $insertId = '0';
    public array $context = [];

    public function __construct(private PDO $schema)
    {
        parent::__construct($schema);
    }

    public function prepare($query)
    {
        $check = $this->schema->prepare($query);
        $columns = null;
        if (($this->context['action'] ?? null) === 'select') {
            // Preparing a SELECT alone does not expose PDO's result metadata.
            $check->execute();
            $columns = [];
            for ($index = 0; $index < $check->columnCount(); $index++) {
                $columns[] = $check->getColumnMeta($index)['name'];
            }
        }
        return new NativeStatement($this, $query, $this->context, $columns);
    }

    public function lastInsertId($sequence = null)
    {
        return $this->insertId;
    }

    public function select($table, $options = [])
    {
        $this->context = ['action' => 'select', 'table' => $table];
        return parent::select($table, $options);
    }

    public function insert($table, $rows, $method = null)
    {
        $this->context = ['action' => 'insert', 'table' => $table];
        return parent::insert($table, $rows, $method);
    }

    public function update($table, $data, $where = [], $params = [])
    {
        $this->context = [
            'action' => 'update', 'table' => $table, 'values' => $data,
            'before_query' => 'SELECT * FROM ' . $this->quoteIdentifier($table) . $this->getSuffix($where),
        ];
        return parent::update($table, $data, $where, $params);
    }

    public function delete($table, $where = [], $params = [])
    {
        $this->context = [
            'action' => 'delete', 'table' => $table,
            'before_query' => 'SELECT * FROM ' . $this->quoteIdentifier($table) . $this->getSuffix($where),
        ];
        return parent::delete($table, $where, $params);
    }
}

class NativeStatement
{
    private array $rows = [];
    private int $position = 0;

    public function __construct(
        private NativeDatabase $database,
        private string $query,
        private array $context,
        private ?array $columns,
    ) {
    }

    public function setFetchMode($mode)
    {
        return true;
    }

    public function execute($parameters = null)
    {
        $result = Fiber::suspend([
            'query' => $this->query, 'parameters' => $parameters ?? [], 'context' => $this->context,
        ]);
        if (isset($result['error'])) {
            throw new PDOException($result['error']);
        }
        if (isset($result['insert_id'])) {
            $this->database->insertId = (string)$result['insert_id'];
        }
        $this->rows = $result['rows'];
        if ($this->columns !== null) {
            $keys = array_flip($this->columns);
            $this->rows = array_map(fn($row) => array_intersect_key($row, $keys), $this->rows);
        }
        $this->position = 0;
        return true;
    }

    public function fetchAll()
    {
        return $this->rows;
    }

    public function fetch()
    {
        return $this->rows[$this->position++] ?? false;
    }
}

function nativeSchema(): PDO
{
    $schema = new PDO('sqlite::memory:');
    $schema->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $schema->sqliteCreateFunction('grocy_user_setting', fn($key) => null, 1);
    $definitions = json_decode(file_get_contents(__DIR__ . '/../db/compatibility/grocy_4_5_0_schema.json'), true, 512, JSON_THROW_ON_ERROR);
    foreach (['ddl', 'views'] as $kind) {
        foreach ($definitions[$kind] as $statement) {
            $schema->exec($statement);
        }
    }
    return $schema;
}

function genericWrite(array $request, PDO $schema): array
{
    $database = new NativeDatabase($schema);
    $fiber = new Fiber(function () use ($request, $database) {
        try {
            if ($request['method'] === 'POST') {
                $database->table($request['entity'])->createRow($request['body'])->save();
                return ['created_object_id' => $database->lastInsertId()];
            }
            $row = $database->table($request['entity'], $request['object_id']);
            if ($row === null) {
                return ['status' => 400, 'error_message' => 'Object not found'];
            }
            if ($request['method'] === 'DELETE') {
                $row->delete();
            } else {
                $row->update($request['body']);
            }
            return [];
        } catch (Throwable $error) {
            return [
                'status' => $request['method'] !== 'DELETE' && $error instanceof Exception ? 400 : 500,
                'error_message' => $error->getMessage(),
            ];
        }
    });
    $step = $fiber->start();
    while (!$fiber->isTerminated()) {
        reply(['id' => $request['id'], 'ok' => true, 'query' => $step]);
        $line = fgets(STDIN);
        if ($line === false) {
            throw new RuntimeException('Native SQL execution stopped');
        }
        $resume = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
        if ($resume['id'] !== $request['id']) {
            throw new RuntimeException('Native SQL response ID is invalid');
        }
        $step = $fiber->resume($resume['resume']);
    }
    return $fiber->getReturn();
}
