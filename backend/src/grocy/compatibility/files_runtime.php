<?php

// Each file request owns its PHP stream and GD resources until the response ends.
error_reporting(E_ALL ^ (E_NOTICE | E_WARNING | E_DEPRECATED));
require __DIR__ . '/request_runtime.php';
require __DIR__ . '/generic_runtime.php';
$emitting = false;

class NativeFilesController extends Grocy\Controllers\FilesApiController
{
    public function __construct(private string $root)
    {
    }

    protected function getFilesService()
    {
        return new NativeFilesService($this->root);
    }

    public function errorResponse($response, Throwable $error)
    {
        $status = $error instanceof Slim\Exception\HttpException ? $error->getCode() : 500;
        return $this->ApiResponse($response->withStatus($status), [
            'error_message' => $error->getMessage(),
            'error_details' => nativeErrorDetails($error),
        ]);
    }
}

class NativeFilesService extends Grocy\Services\FilesService
{
    public function __construct(string $root)
    {
        if (!is_dir($root)) {
            mkdir($root, 0777, true);
        }
        // The application config selects the storage root; all file logic stays native.
        (new ReflectionProperty(Grocy\Services\FilesService::class, 'StoragePath'))->setValue($this, $root);
    }
}

class NativeFileInput extends Slim\Psr7\Stream
{
    public function read($length): string
    {
        $data = '';
        // The HTTP input stream fills the requested chunk; stdin pipes can return early.
        while (strlen($data) < $length && !$this->eof()) {
            $data .= parent::read($length - strlen($data));
        }
        return $data;
    }
}

try {
    $input = json_decode(fgets(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        $input['method'], 'http://localhost' . base64_decode($input['uri'], true)
    );
    $http = $http->withBody(new NativeFileInput(STDIN));
    $controller = new NativeFilesController($input['root']);
    $response = nativeApiResponse();
    try {
        if (!$input['matched']) {
            throw new Slim\Exception\HttpNotFoundException($http);
        }
        $args = ['group' => $input['group'], 'fileName' => $input['file_name']];
        $response = match ($input['method']) {
            'GET', 'HEAD' => $controller->ServeFile($http, $response, $args),
            'PUT' => $controller->UploadFile($http, $response, $args),
            'DELETE' => $controller->DeleteFile($http, $response, $args),
        };
    } catch (Throwable $error) {
        $response = $controller->errorResponse($response, $error);
    }
    if (!$response->hasHeader('Content-Disposition')) {
        $response = $response->withHeader('Content-Type', 'application/json');
    }
    foreach (nativeCorsHeaders() as $name => $values) {
        $response = $response->withHeader($name, $values);
    }
    // PHP's HTTP SAPI adds the default charset to text media types.
    $type = $response->getHeaderLine('Content-Type');
    $charset = ini_get('default_charset');
    if (str_starts_with(strtolower($type), 'text/') && stripos($type, 'charset=') === false && $charset !== '') {
        $response = $response->withHeader('Content-Type', $type . ';charset=' . $charset);
    }
    $headers = [];
    foreach ($response->getHeaders() as $name => $values) {
        foreach ($values as $value) {
            $headers[] = [base64_encode(strtolower($name)), base64_encode($value)];
        }
    }
    fwrite(STDOUT, json_encode(['protocol' => 1, 'status' => $response->getStatusCode(), 'headers' => $headers], JSON_THROW_ON_ERROR) . "\n");
    fflush(STDOUT);
    $emitting = true;
    if ($input['method'] === 'HEAD' || in_array($response->getStatusCode(), [204, 205, 304], true)) {
        exit(0);
    }
    $body = $response->getBody();
    if ($body->isSeekable()) {
        $body->rewind();
    }
    while (!$body->eof()) {
        fwrite(STDOUT, $body->read(4096));
    }
} catch (Throwable $error) {
    fwrite(STDERR, 'Native file request failed: ' . get_class($error) . "\n");
    if (!$emitting) {
        fwrite(STDOUT, "{\"protocol\":1,\"error\":true}\n");
    }
    exit(1);
}
