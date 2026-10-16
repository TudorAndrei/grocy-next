<?php

$token = getenv('GROCY_NATIVE_HTTP_TOKEN');
$prefix = '/' . $token . '/';
if (!is_string($token) || !str_starts_with($_SERVER['REQUEST_URI'], $prefix)) {
    http_response_code(404);
    return;
}
foreach (['REQUEST_URI', 'SCRIPT_NAME', 'PHP_SELF'] as $name) {
    if (isset($_SERVER[$name]) && str_starts_with($_SERVER[$name], $prefix)) {
        $_SERVER[$name] = substr($_SERVER[$name], strlen($prefix) - 1);
    }
}
$GLOBALS['NativeChannel'] = stream_socket_client('unix://' . getenv('GROCY_NATIVE_CONTROL'));
define('NATIVE_HTTP_CONTEXT', true);
$argv = [__FILE__, getenv('GROCY_NATIVE_CACHE'), '-', getenv('GROCY_NATIVE_DATAPATH')];
foreach (['GROCY_NATIVE_HTTP_TOKEN', 'GROCY_NATIVE_CONTROL', 'GROCY_NATIVE_CACHE', 'GROCY_NATIVE_DATAPATH'] as $name) {
    putenv($name);
    unset($_SERVER[$name], $_ENV[$name]);
}
require __DIR__ . '/purifier.php';
