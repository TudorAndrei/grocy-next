<?php

// Execute Grocy 4.5.0's pinned LessQL against the application's SQLite connection.
// The private schema checks native column names before local extensions can affect SQL.
class NativeDatabase extends LessQL\Database
{
    public string $insertId = '0';
    public array $context = [];
    public bool $authenticatedKeySelected = false;

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
        // IsValidApiKey may skip an unchanged last_used write within one second.
        // GetUserByApiKey still performs this distinct credential lookup.
        if ($table === 'api_keys' && count($options['where'] ?? []) === 1
            && str_starts_with($options['where'][0], '`api_key` ')) {
            $this->authenticatedKeySelected = true;
        }
        $this->context = ['action' => 'select', 'table' => $table];
        return parent::select($table, $options);
    }

    public function readQuery(string $query)
    {
        $this->context = ['action' => 'select', 'table' => ''];
        $statement = $this->prepare($query);
        $statement->execute();
        return $statement;
    }

    public function prepareExecution(string $query)
    {
        $this->context = ['action' => 'execute', 'table' => ''];
        $productDelete = 'DELETE FROM products WHERE ';
        if (str_starts_with($query, $productDelete)) {
            // The application's nutrition references need the same cleanup as
            // a generic product delete, inside Grocy's existing transaction.
            $this->context = [
                'action' => 'delete', 'table' => 'products',
                'before_query' => 'SELECT * FROM products WHERE ' . substr($query, strlen($productDelete)),
            ];
        }
        return $this->prepare($query);
    }

    public function executeQuery(string $query)
    {
        $statement = $this->prepareExecution($query);
        $statement->execute();
        return $statement;
    }

    public function transaction(string $action)
    {
        $method = match ($action) {
            'begin' => 'beginTransaction', 'commit' => 'commit', 'rollback' => 'rollBack',
        };
        if ($action === 'begin') {
            $this->schema->beginTransaction();
        } elseif (!$this->schema->inTransaction()) {
            // Let this PHP runtime produce its own PDO transaction error.
            return $this->schema->$method();
        }
        try {
            $result = (new NativeStatement($this, '', ['action' => $action, 'table' => ''], null))->execute();
        } catch (Throwable $error) {
            if ($action === 'begin' && $this->schema->inTransaction()) {
                $this->schema->rollBack();
            }
            throw $error;
        }
        if ($action !== 'begin') {
            $this->schema->$method();
        }
        return $result;
    }

    public function sqliteAbortedTransaction(): void
    {
        // PDO 8.3 and 8.4 report implicit SQLite rollback differently. Retain the
        // actual driver's state by applying the same rollback to the private PDO.
        $this->schema->exec('ROLLBACK');
    }

    public function insert($table, $rows, $method = null)
    {
        $this->context = ['action' => 'insert', 'table' => $table];
        return parent::insert($table, $rows, $method);
    }

    public function update($table, $data, $where = [], $params = [])
    {
        if ($table === 'api_keys' && array_key_exists('last_used', $data)) {
            $this->authenticatedKeySelected = true;
        }
        $this->context = [
            'action' => 'update', 'table' => $table,
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
    private int $affectedRows = 0;

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
        if ($result['transaction_aborted'] ?? false) {
            $this->database->sqliteAbortedTransaction();
        }
        if (isset($result['error'])) {
            if (($result['error_kind'] ?? null) === 'error') {
                throw new Error($result['error']);
            }
            throw new PDOException($result['error']);
        }
        if (isset($result['insert_id'])) {
            $this->database->insertId = (string)$result['insert_id'];
        }
        $this->rows = array_map(
            fn($row) => array_map('nativeFetchedValue', $row), $result['rows']
        );
        if ($this->columns !== null) {
            $keys = array_flip($this->columns);
            $this->rows = array_map(function ($row) use ($keys) {
                $ordered = [];
                foreach ($keys as $name => $_position) {
                    if (array_key_exists($name, $row)) {
                        $ordered[$name] = $row[$name];
                    }
                }
                return $ordered;
            }, $this->rows);
        }
        $this->position = 0;
        $this->affectedRows = $result['row_count'] ?? 0;
        return true;
    }

    public function rowCount(): int
    {
        return $this->affectedRows;
    }

    public function fetchAll($mode = PDO::FETCH_ASSOC)
    {
        $rows = array_slice($this->rows, $this->position);
        $this->position = count($this->rows);
        $group = ($mode & PDO::FETCH_GROUP) !== 0;
        $object = ($mode & ~PDO::FETCH_GROUP) === PDO::FETCH_OBJ;
        $result = [];
        foreach ($rows as $row) {
            if ($group) {
                $key = array_shift($row);
                $result[$key][] = $object ? (object)$row : $row;
            } else {
                $result[] = $object ? (object)$row : $row;
            }
        }
        return $result;
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
    $schema->sqliteCreateFunction('regexp', fn($pattern, $value) => nativeSqliteFunction('regexp', [$pattern, $value]), 2);
    $schema->sqliteCreateFunction('ceil', fn($value) => ceil($value), 1);
    $definitions = json_decode(file_get_contents(__DIR__ . '/../db/compatibility/grocy_4_5_0_schema.json'), true, 512, JSON_THROW_ON_ERROR);
    foreach (['ddl', 'views', 'triggers'] as $kind) {
        foreach ($definitions[$kind] as $statement) {
            $schema->exec($statement);
        }
    }
    return $schema;
}

function nativeDecodeValue($value)
{
    if (is_array($value) && isset($value['binary'])) {
        return base64_decode($value['binary'], true);
    }
    if (is_array($value) && isset($value['nonfinite'])) {
        return match ($value['nonfinite']) {
            'nan' => NAN, 'inf' => INF, '-inf' => -INF,
        };
    }
    return $value;
}

function nativeEncodeValue($value)
{
    if (is_float($value) && !is_finite($value)) {
        return ['nonfinite' => is_nan($value) ? 'nan' : ($value > 0 ? 'inf' : '-inf')];
    }
    if (is_string($value) && !mb_check_encoding($value, 'UTF-8')) {
        return ['binary' => base64_encode($value)];
    }
    return $value;
}

function nativeFetchedValue($value)
{
    // PDO::NULL_EMPTY_STRING also converts a zero-length BLOB after fetching.
    $value = nativeDecodeValue($value);
    return $value === '' ? null : $value;
}

// These are DatabaseService's SQLite callbacks, evaluated by PHP itself.
function nativeSqliteFunction(string $name, array $arguments)
{
    $arguments = array_map('nativeDecodeValue', $arguments);
    if ($name === 'regexp') {
        mb_regex_encoding('UTF-8');
        return (false !== mb_ereg($arguments[0], $arguments[1])) ? 1 : 0;
    }
    if ($name === 'ceil') {
        return ceil($arguments[0]);
    }
    throw new RuntimeException('Unknown native SQLite function');
}

class NativeUserfieldsService extends Grocy\Services\UserfieldsService
{
    public function __construct(private NativeDatabase $database)
    {
    }

    protected function getDatabase()
    {
        return $this->database;
    }
}

class NativeGenericController extends Grocy\Controllers\GenericEntityApiController
{
    private NativeUserfieldsService $fields;

    public function __construct(private NativeDatabase $database)
    {
        $this->fields = new NativeUserfieldsService($database);
    }

    protected function getDatabase()
    {
        return $this->database;
    }

    protected function getUserfieldsService()
    {
        return $this->fields;
    }

    public function parseBody($request)
    {
        return $this->GetParsedAndFilteredRequestBody($request);
    }
}

function nativeWriteBody(array $request, NativeDatabase $database)
{
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        $request['method'], 'http://localhost/'
    );
    $http = $http->withBody((new Slim\Psr7\Factory\StreamFactory())->createStream(
        base64_decode($request['json'], true)
    ));
    $http = $http->withHeader('Content-Type', $request['content_type']);
    return (new NativeGenericController($database))->parseBody(new Slim\Http\ServerRequest($http));
}

function nativeGetRequest(array $request)
{
    return (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        'GET', 'http://localhost/api/?' . base64_decode($request['query_string'], true)
    );
}

function nativeApiResponse()
{
    $response = new Slim\Http\Response(
        (new Slim\Psr7\Factory\ResponseFactory())->createResponse(),
        new Slim\Psr7\Factory\StreamFactory()
    );
    return $response->withHeader('Content-Type', 'application/json');
}

function nativeGenericRead(array $request, NativeDatabase $database): array
{
    $http = nativeGetRequest($request);
    $response = nativeApiResponse();
    $controller = new NativeGenericController($database);
    $args = ['entity' => $request['entity']];
    if ($request['operation'] === 'field_read') {
        $args['objectId'] = $request['object_id'];
        $response = $controller->GetUserfields($http, $response, $args);
    } elseif ($request['object_id'] === null) {
        $response = $controller->GetObjects($http, $response, $args);
    } else {
        $args['objectId'] = $request['object_id'];
        $response = $controller->GetObject($http, $response, $args);
    }
    return nativeEncodedResponse($response);
}

function nativeCorsHeaders(): array
{
    return [
        'Access-Control-Allow-Origin' => ['*'],
        'Access-Control-Allow-Methods' => ['GET, POST, PUT, DELETE, OPTIONS'],
        'Access-Control-Allow-Headers' => ['*'],
    ];
}

function nativeEncodedResponse($response): array
{
    // Keep JsonMiddleware and the outer CorsMiddleware headers.
    if (!$response->hasHeader('Content-Disposition')) {
        $response = $response->withHeader('Content-Type', 'application/json');
    }
    foreach (nativeCorsHeaders() as $name => $values) {
        $response = $response->withHeader($name, $values);
    }
    // PHP's HTTP emitter suppresses bodies for these status codes.
    $body = in_array($response->getStatusCode(), [204, 205, 304], true) ? '' : (string)$response->getBody();
    return [
        'response' => base64_encode($body),
        'status' => $response->getStatusCode(),
        'headers' => $response->getHeaders(),
    ];
}

function nativeErrorDetails(Throwable $error): array
{
    // ExceptionController includes these diagnostics for uncaught API errors.
    return [
        'stack_trace' => $error->getTraceAsString(),
        'file' => $error->getFile(),
        'line' => $error->getLine(),
    ];
}

function nativeDatabaseRequest(array $request, PDO $schema): array
{
    $database = new NativeDatabase($schema);
    $fiber = new Fiber(function () use ($request, $database) {
        $parsing = false;
        try {
            if ($request['operation'] === 'action') {
                return nativeAction($request, $database);
            }
            if ($request['operation'] === 'list_read') {
                return nativeListRead($request, $database);
            }
            if (in_array($request['operation'], ['generic_read', 'field_read'], true)) {
                return nativeGenericRead($request, $database);
            }
            if ($request['method'] !== 'DELETE') {
                // Grocy parses outside its write exception handler.
                $parsing = true;
                $body = nativeWriteBody($request, $database);
                $parsing = false;
                if ($body === null) {
                    throw new Exception('Request body could not be parsed (probably invalid JSON format or missing/wrong Content-Type header)');
                }
            }
            if ($request['operation'] === 'field_write') {
                (new NativeUserfieldsService($database))->SetValues(
                    $request['entity'], $request['object_id'], $body
                );
                return [];
            }
            if ($request['method'] === 'POST') {
                $database->table($request['entity'])->createRow($body)->save();
                return ['created_object_id' => $database->lastInsertId()];
            }
            $row = $database->table($request['entity'], $request['object_id']);
            if ($row === null) {
                return ['status' => 400, 'error_message' => 'Object not found'];
            }
            if ($request['method'] === 'DELETE') {
                $row->delete();
            } else {
                $row->update($body);
            }
            return [];
        } catch (Throwable $error) {
            $data = [
                'error_message' => $error->getMessage(),
            ];
            $read = in_array($request['operation'], ['generic_read', 'field_read', 'list_read'], true);
            $uncaught = $parsing || $read || ($request['method'] ?? 'PUT') === 'DELETE' || $error instanceof Error;
            if ($uncaught) {
                $data['error_details'] = nativeErrorDetails($error);
            }
            if ($read) {
                return [
                    'response' => base64_encode(json_encode($data)), 'status' => 500,
                    'headers' => ['Content-Type' => ['application/json']] + nativeCorsHeaders(),
                ];
            }
            $status = $error instanceof Slim\Exception\HttpException ? $error->getCode() : ($uncaught ? 500 : 400);
            return ['status' => $status] + $data;
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
