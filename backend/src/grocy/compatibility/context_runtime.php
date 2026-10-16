<?php

// One native context owns configuration, authentication, and controller state.
function nativeRequestContext(array $request, NativeDatabase $database): array
{
    global $GROCY_DEFAULT_USER_SETTINGS;
    $GROCY_DEFAULT_USER_SETTINGS = [];
    $GLOBALS['NativeConfiguration'] = $request['configuration'];
    define('GROCY_IS_EMBEDDED_INSTALL', false);
    foreach ($request['configuration'] as $name => $value) {
        if (!str_starts_with($name, 'GROCY_') && $name !== 'NATIVE_DATABASE_FILE') define($name, $value);
    }
    nativeHttpEnvironment($request);
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
        echo 'Invalid setting in config.php: ' . $error->getMessage();
        return ['terminal' => true];
    }
    $cache = GROCY_DATAPATH . '/viewcache';
    $hash = hash('sha256', file_get_contents(__DIR__ . '/../_vendor/grocy-core/version.json') . GROCY_BASE_URL . GROCY_BASE_PATH);
    if (!file_exists($cache . '/' . $hash . '.txt')) {
        EmptyFolder($cache);
        touch($cache . '/' . $hash . '.txt');
        if (function_exists('opcache_reset')) opcache_reset();
        header('Location: ' . (new Grocy\Helpers\UrlManager(GROCY_BASE_URL))->ConstructUrl('/'));
        return ['terminal' => true];
    }
    $http = nativeHttpRequest($request);
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
    $GLOBALS['NativeExceptionController'] = new NativeExceptionController($app);
    ob_clean();
    if (class_exists(Grocy\Services\DatabaseService::class, false) && !isset($GLOBALS['NativeDatabaseBound'])) nativeBindHttpDatabase();
    $result = nativeProtocol([
        'method' => $http->getMethod(),
        'path' => base64_encode($http->getUri()->getPath()),
    ]);
    $result['context'] = [
        'mode' => GROCY_MODE,
        'disable_auth' => (bool)GROCY_DISABLE_AUTH,
        'base_path' => GROCY_BASE_PATH,
        'auth_class' => GROCY_AUTH_CLASS,
        'direct_database' => in_array(GROCY_MODE, ['demo', 'prerelease'], true),
        'is_api_route' => str_starts_with($http->getUri()->getPath(), '/api/'),
        'login_url' => $container->get('UrlManager')->ConstructUrl('/login'),
        'stock_due_soon_days' => nativeEncodeValue($GROCY_DEFAULT_USER_SETTINGS['stock_due_soon_days']),
    ];
    return $result;
}

function nativeHttpRequest(array $request)
{
    if (defined('NATIVE_HTTP_CONTEXT')) {
        if (!isset($GLOBALS['NativeIncomingRequest'])) {
            $http = new Slim\Http\ServerRequest(Slim\Psr7\Factory\ServerRequestFactory::createFromGlobals());
            $GLOBALS['NativeIncomingRequest'] = $http;
        }
        return $GLOBALS['NativeIncomingRequest'];
    }
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

function nativeHttpEnvironment(array $request): void
{
    $uri = parse_url($request['uri']);
    $_SERVER['SERVER_NAME'] = $uri['host'];
    $_SERVER['SERVER_PORT'] = $uri['port'] ?? ($uri['scheme'] === 'https' ? 443 : 80);
    $_SERVER['REQUEST_SCHEME'] = $uri['scheme'];
    if ($uri['scheme'] === 'https') $_SERVER['HTTPS'] = 'on';
    else unset($_SERVER['HTTPS']);
    if (isset($request['client'])) {
        [$_SERVER['REMOTE_ADDR'], $_SERVER['REMOTE_PORT']] = $request['client'];
    }
}

function nativeBindHttpDatabase(): void
{
    if (isset($GLOBALS['NativeDatabaseBound'])) return;
    $database = $GLOBALS['NativeRequestDatabase'];
    $service = new Grocy\Services\DatabaseService();
    $mode = in_array(GROCY_MODE, ['demo', 'prerelease'], true);
    if (!defined('NATIVE_DATABASE_FILE')) {
        define('NATIVE_DATABASE_FILE', $mode
            ? (new ReflectionMethod(Grocy\Services\DatabaseService::class, 'GetDbFilePath'))->invoke($service)
            : $GLOBALS['NativeConfiguration']['NATIVE_DATABASE_FILE']);
    }
    if ($mode) $database->useNativeDatabase($service->GetDbConnectionRaw());
    (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'DbConnection'))->setValue(null, $database);
    (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'instance'))->setValue(null, new NativeReadDatabaseService($database));
    $GLOBALS['NativeDatabaseBound'] = true;
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
