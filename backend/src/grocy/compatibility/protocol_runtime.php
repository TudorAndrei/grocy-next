<?php

// Use the release's route declarations and framework for HTTP method decisions.
class NativeApiKeyAuthMiddleware extends Grocy\Middleware\ApiKeyAuthMiddleware
{
    public function __construct(string $header)
    {
        $this->ApiKeyHeaderName = $header;
    }
}

function nativeRouter(): Slim\App
{
    static $router = null;
    if ($router === null) {
        $app = new Slim\App(new Slim\Psr7\Factory\ResponseFactory());
        require __DIR__ . '/../_vendor/grocy-core/routes.php';
        $router = $app;
    }
    return $router;
}

class NativeExceptionController extends Grocy\Controllers\ExceptionController
{
    public function __construct(Slim\App $app)
    {
        (new ReflectionProperty(Grocy\Controllers\ExceptionController::class, 'app'))->setValue($this, $app);
    }
}

class NativeRoutingHandler implements Psr\Http\Server\RequestHandlerInterface
{
    public bool $matched = false;

    public function __construct(private Slim\App $app) {}

    public function handle(Psr\Http\Message\ServerRequestInterface $request): Psr\Http\Message\ResponseInterface
    {
        try {
            (new Slim\Middleware\RoutingMiddleware(
                $this->app->getRouteResolver(), $this->app->getRouteCollector()->getRouteParser()
            ))->performRouting($request);
            $this->matched = true;
            return $this->app->getResponseFactory()->createResponse();
        } catch (Throwable $error) {
            return (new NativeExceptionController($this->app))($request, $error, true, false, false);
        }
    }
}

function nativeProtocol(array $input): array
{
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        $input['method'], 'http://localhost' . base64_decode($input['path'], true)
    );
    $handler = new NativeRoutingHandler(nativeRouter());
    $response = (new Grocy\Middleware\CorsMiddleware(new Slim\Psr7\Factory\ResponseFactory()))->__invoke($http, $handler);
    if (!$response->hasHeader('Content-Type')) {
        // PHP's HTTP SAPI supplies these defaults for an empty response.
        $response = $response->withHeader('Content-Type', ini_get('default_mimetype') . '; charset=' . ini_get('default_charset'));
    }
    return [
        'matched' => $handler->matched,
        'status' => $response->getStatusCode(),
        'headers' => $response->getHeaders(),
        'response' => base64_encode((string)$response->getBody()),
    ];
}
