<?php

// Use the release's route declarations and framework for HTTP method decisions.
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
        parent::__construct($app, $GLOBALS['NativeContainer']);
    }
}

function nativeDispatch($http, NativeDatabase $database)
{
    $container = $GLOBALS['NativeContainer'];
    foreach (['Tasks', 'Chores', 'Batteries', 'Stock', 'Recipes', 'Users', 'System', 'Print', 'Calendar'] as $name) {
        $class = 'Native' . $name . 'Controller';
        $container->set('Grocy\\Controllers\\' . $name . 'ApiController', fn() => new $class($database));
    }
    $container->set(Grocy\Controllers\FilesApiController::class, fn() => new NativeFileRoutesController($database));
    $container->set(Grocy\Controllers\GenericEntityApiController::class, fn() => new NativeGenericController($database));
    $container->set(Grocy\Controllers\OpenApiController::class, fn() => new NativeOpenApiController($database));
    $factory = new Slim\Http\Factory\DecoratedResponseFactory(
        new Slim\Psr7\Factory\ResponseFactory(), new Slim\Psr7\Factory\StreamFactory()
    );
    $app = new Slim\App($factory, $container);
    require __DIR__ . '/../_vendor/grocy-core/routes.php';
    if (!empty(GROCY_BASE_PATH)) $app->setBasePath(GROCY_BASE_PATH);
    $app->addRoutingMiddleware();
    $errors = $app->addErrorMiddleware(true, false, false);
    $errors->setDefaultErrorHandler(new NativeExceptionController($app));
    $app->add(new Grocy\Middleware\CorsMiddleware($factory));
    return $app->handle($http);
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
            $controller = $GLOBALS['NativeExceptionController'] ?? new NativeExceptionController($this->app);
            return $controller($request, $error, true, false, false);
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
