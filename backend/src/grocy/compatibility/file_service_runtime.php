<?php

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
