<?php

// Runtime inputs use the pinned packages in ../_vendor. Each has its own license.
spl_autoload_register(function (string $class): void {
    $prefixes = [
        'Grocy\\Services\\' => ['grocy-core/services/'],
        'Grocy\\Controllers\\' => ['grocy-core/controllers/'],
        'Gumlet\\' => ['gumlet-image-resize/lib/'],
        'LessQL\\' => ['morris-lessql/src/LessQL/'],
        'Slim\\Http\\' => ['slim-http/src/'],
        'Slim\\Exception\\' => ['slim-framework/Slim/Exception/'],
        'Slim\\Psr7\\' => ['slim-psr7/src/'],
        'Psr\\Http\\Message\\' => ['psr-http-message/src/', 'psr-http-factory/src/'],
        'Fig\\Http\\Message\\' => ['fig-http-message-util/src/'],
    ];
    foreach ($prefixes as $prefix => $directories) {
        if (!str_starts_with($class, $prefix)) {
            continue;
        }
        foreach ($directories as $directory) {
            $path = __DIR__ . '/../_vendor/' . $directory . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
            if (is_file($path)) {
                require $path;
                return;
            }
        }
    }
});
require __DIR__ . '/../_vendor/ralouphie-getallheaders/src/getallheaders.php';
require __DIR__ . '/../_vendor/grocy-core/helpers/extensions.php';

function parsedBody(string $raw, string $method, ?string $contentType)
{
    $request = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest($method, 'http://localhost/');
    $request = $request->withBody((new Slim\Psr7\Factory\StreamFactory())->createStream($raw));
    if ($contentType !== null) {
        $request = $request->withHeader('Content-Type', $contentType);
    }
    return (new Slim\Http\ServerRequest($request))->getParsedBody();
}

function filteredBody($body, HTMLPurifier $purifier)
{
    foreach ($body as &$value) {
        if (!is_bool($value) && !is_array($value)) {
            $value = $purifier->purify($value);
            $value = str_replace('&amp;', '&', $value);
            $value = str_replace('&gt;', '>', $value);
            $value = str_replace('&lt;', '<', $value);
        }
    }
    unset($value);
    return $body;
}

class PermissionQueryCompiled extends Exception
{
    public function __construct(public string $query, public array $parameters)
    {
        parent::__construct();
    }
}

function permissionQuery(array $request, string $raw, HTMLPurifier $purifier, PDO $pdo): array
{
    $replace = $request['method'] === 'PUT';
    $clear = false;
    try {
        if (!$replace && $request['content_type'] !== 'application/json') {
            return ['clear' => false, 'error_message' => 'Bad Content-Type', 'status' => 400];
        }
        $body = parsedBody($raw, $request['method'], $request['content_type']);
        if (!$replace) {
            $body = filteredBody($body, $purifier);
        }
        $clear = $replace;
        $database = new LessQL\Database($pdo);
        $database->setQueryCallback(function ($query, $parameters): void {
            // Capture the actual LessQL statement before it can execute on the private PDO.
            throw new PermissionQueryCompiled($query, $parameters);
        });
        if ($replace) {
            $rows = [];
            foreach ($body['permissions'] as $permission) {
                $rows[] = ['user_id' => $request['user_id'], 'permission_id' => $permission];
            }
            $database->insert('user_permissions', $rows, 'batch');
        } else {
            $database->user_permissions()->createRow([
                'user_id' => $request['user_id'],
                'permission_id' => $body['permission_id'],
            ])->save();
        }
        return ['clear' => $clear, 'query' => null, 'parameters' => []];
    } catch (PermissionQueryCompiled $query) {
        return ['clear' => $clear, 'query' => $query->query, 'parameters' => $query->parameters];
    } catch (Throwable $error) {
        return [
            'clear' => $clear,
            'error_message' => $error->getMessage(),
            'status' => $error instanceof Exception ? 400 : 500,
        ];
    }
}
