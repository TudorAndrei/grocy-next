<?php

// One native context owns configuration, authentication, and controller state.
function nativeRequestContext(array $request, NativeDatabase $database): array
{
    try {
        global $GROCY_DEFAULT_USER_SETTINGS;
        $GROCY_DEFAULT_USER_SETTINGS = [];
        define('GROCY_IS_EMBEDDED_INSTALL', false);
        foreach ($request['configuration'] as $name => $value) {
            if (!str_starts_with($name, 'GROCY_') && $name !== 'NATIVE_DATABASE_FILE') define($name, $value);
        }
        (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'DbConnection'))->setValue(null, $database);
        (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'instance'))->setValue(null, new NativeReadDatabaseService($database));
        $_COOKIE = unserialize(base64_decode($request['cookies'], true), ['allowed_classes' => false]);
        $http = nativeHttpRequest($request);
        ob_start();
        if (is_file(GROCY_DATAPATH . '/config.php')) require GROCY_DATAPATH . '/config.php';
        Setting('DEFAULT_PERMISSIONS', $request['default_permissions']);
        foreach ($request['configuration'] as $name => $value) {
            if (str_starts_with($name, 'GROCY_')) Setting(substr($name, 6), $value);
        }
        require __DIR__ . '/../_vendor/grocy-core/config-dist.php';
        error_reporting(GROCY_MODE === 'dev' ? E_ALL : E_ALL ^ (E_NOTICE | E_WARNING | E_DEPRECATED));
        require_once __DIR__ . '/../_vendor/grocy-core/helpers/ConfigurationValidator.php';
        try {
            (new ConfigurationValidator())->validateConfig();
        } catch (EInvalidConfig $error) {
            $body = ob_get_clean() . 'Invalid setting in config.php: ' . $error->getMessage();
            return nativeContextTerminal(200, $body);
        }
        ob_end_clean();
        $cache = GROCY_DATAPATH . '/viewcache';
        $hash = hash('sha256', file_get_contents(__DIR__ . '/../_vendor/grocy-core/version.json') . GROCY_BASE_URL . GROCY_BASE_PATH);
        if (!file_exists($cache . '/' . $hash . '.txt')) {
            EmptyFolder($cache);
            touch($cache . '/' . $hash . '.txt');
            if (function_exists('opcache_reset')) opcache_reset();
            $result = nativeContextTerminal(302, '');
            $result['headers']['Location'] = [(new Grocy\Helpers\UrlManager(GROCY_BASE_URL))->ConstructUrl('/')];
            return $result;
        }
        $nativeService = new Grocy\Services\DatabaseService();
        $modeDatabase = in_array(GROCY_MODE, ['demo', 'prerelease'], true);
        define('NATIVE_DATABASE_FILE', $modeDatabase
            ? (new ReflectionMethod(Grocy\Services\DatabaseService::class, 'GetDbFilePath'))->invoke($nativeService)
            : $request['configuration']['NATIVE_DATABASE_FILE']);
        if ($modeDatabase) $database->useNativeDatabase($nativeService->GetDbConnectionRaw());
        if (in_array(GROCY_MODE, ['dev', 'demo', 'prerelease'], true) || GROCY_DISABLE_AUTH === true) {
            define('GROCY_USER_ID', 1);
        }
        $container = new DI\Container();
        $container->set('ApiKeyHeaderName', $request['api_key_header']);
        $container->set('UrlManager', new Grocy\Helpers\UrlManager(GROCY_BASE_URL));
        $container->set('view', fn() => new Slim\Views\Blade(
            __DIR__ . '/../_vendor/grocy-core/views', GROCY_DATAPATH . '/viewcache'
        ));
        $GLOBALS['NativeContainer'] = $container;
        $class = GROCY_AUTH_CLASS;
        $GLOBALS['NativeAuthentication'] = new $class($container, new Slim\Psr7\Factory\ResponseFactory());
        $app = nativeRouter();
        if (!empty(GROCY_BASE_PATH)) $app->setBasePath(GROCY_BASE_PATH);
        $result = nativeProtocol([
            'method' => $request['method'],
            'path' => base64_encode($http->getUri()->getPath()),
        ]);
        $result['context'] = [
            'mode' => GROCY_MODE,
            'disable_auth' => (bool)GROCY_DISABLE_AUTH,
            'base_path' => GROCY_BASE_PATH,
            'auth_class' => GROCY_AUTH_CLASS,
            'direct_database' => $database->direct,
            'is_api_route' => str_starts_with($http->getUri()->getPath(), '/api/'),
            'login_url' => $container->get('UrlManager')->ConstructUrl('/login'),
            'stock_due_soon_days' => nativeEncodeValue($GROCY_DEFAULT_USER_SETTINGS['stock_due_soon_days']),
        ];
        return $result;
    } catch (Throwable $error) {
        if (ob_get_level() > 0) ob_end_clean();
        return nativeContextTerminal(500, '');
    }
}

function nativeContextTerminal(int $status, string $body): array
{
    return [
        'matched' => false, 'status' => $status, 'response' => base64_encode($body),
        'headers' => ['Content-Type' => [ini_get('default_mimetype') . '; charset=' . ini_get('default_charset')]],
    ];
}

function nativeHttpRequest(array $request)
{
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest($request['method'], $request['uri'])->withoutHeader('Host');
    foreach ($request['headers'] as [$name, $value]) {
        $http = $http->withAddedHeader(base64_decode($name), base64_decode($value));
    }
    // PHP's HTTP SAPI combines repeated fields before Slim reads the headers.
    foreach ($http->getHeaders() as $name => $values) {
        $http = $http->withHeader($name, implode(', ', $values));
    }
    $http = new Slim\Http\ServerRequest($http);
    foreach ($http->getHeaders() as $name => $values) {
        $_SERVER['HTTP_' . str_replace('-', '_', strtoupper($name))] = implode(', ', $values);
    }
    $_SERVER['HTTP_HOST'] = $http->getHeaderLine('Host');
    $_SERVER['REQUEST_URI'] = $http->getRequestTarget();
    $_GET = $http->getQueryParams();
    if ($http->getUri()->getScheme() === 'https') $_SERVER['HTTPS'] = 'on';
    return $http;
}

class NativeResolvedAuth extends Grocy\Middleware\AuthMiddleware
{
    public function __construct(private $user) {}
    public function authenticate(Psr\Http\Message\ServerRequestInterface $request) { return $this->user; }
    public static function ProcessLogin(array $postParams) { throw new Exception('Not implemented'); }
}

class NativeIdentityHandler implements Psr\Http\Server\RequestHandlerInterface
{
    public function handle(Psr\Http\Message\ServerRequestInterface $request): Psr\Http\Message\ResponseInterface
    {
        if (!defined('GROCY_LOCALE')) {
            define('GROCY_LOCALE', in_array(GROCY_MODE, ['production', 'dev'], true)
                ? (new NativeLocaleMiddleware())->selectLocale($request) : GROCY_DEFAULT_LOCALE);
        }
        return nativeApiResponse();
    }
}

function nativeAttachIdentity($user, $http): void
{
    $app = nativeRouter();
    $http = (new Slim\Middleware\RoutingMiddleware($app->getRouteResolver(), $app->getRouteCollector()->getRouteParser()))->performRouting($http);
    (new NativeResolvedAuth($user))->__invoke($http, new NativeIdentityHandler());
}

function nativeAuthenticate(array $request, NativeDatabase $database, $http): array
{
    $app = nativeRouter();
    $http = (new Slim\Middleware\RoutingMiddleware($app->getRouteResolver(), $app->getRouteCollector()->getRouteParser()))->performRouting($http);
    $bypass = in_array(GROCY_MODE, ['dev', 'demo', 'prerelease'], true) || GROCY_IS_EMBEDDED_INSTALL || GROCY_DISABLE_AUTH;
    $user = $bypass ? null : (new ReflectionMethod($GLOBALS['NativeAuthentication'], 'authenticate'))->invoke($GLOBALS['NativeAuthentication'], $http);
    if ($bypass || $user !== null) nativeAttachIdentity($user, $http);
    $query = $http->getQueryParam($request['arguments']['header']);
    $secret = $http->getQueryParam('secret');
    return nativeEncodedResponse(nativeApiResponse()->withJson([
        'user_id' => defined('GROCY_USER_ID') ? GROCY_USER_ID : ($user === null ? null : $user->id),
        'selected' => $bypass || $user !== null || $database->authenticatedKeySelected,
        'username' => defined('GROCY_USER_USERNAME') && is_string(GROCY_USER_USERNAME) ? base64_encode(GROCY_USER_USERNAME) : null,
        'header' => base64_encode($http->getHeaderLine($request['arguments']['header'])),
        'query_key' => is_string($query) ? base64_encode($query) : null,
        'secret' => is_string($secret) ? base64_encode($secret) : null,
    ]));
}
