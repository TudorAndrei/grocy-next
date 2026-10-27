# Python barcode plugins

The release runs Python plugins. PHP plugins are only used by the legacy test server.

Set `GROCY_STOCK_BARCODE_LOOKUP_PLUGIN=MyBarcodeLookupPlugin`. Put the file at
`<GROCY_DATAPATH>/plugins/MyBarcodeLookupPlugin.py`. A user plugin has priority over
a bundled plugin with the same name.

```python
from grocy.plugins import BaseBarcodeLookupPlugin


class MyBarcodeLookupPlugin(BaseBarcodeLookupPlugin):
    plugin_name = "My lookup service"

    def execute_lookup(self, barcode):
        if barcode != "123456789":
            return None
        return {
            "name": "Example product",
            "location_id": self.locations[0]["id"],
            "qu_id_purchase": self.quantity_units[0]["id"],
            "qu_id_stock": self.quantity_units[0]["id"],
            "__qu_factor_purchase_to_stock": 1,
            "__barcode": barcode,
        }
```

The plugin receives active locations, active quantity units, and the current user
settings. The first two values are lists of record dictionaries. User settings are
a dictionary. `execute_lookup` can be a normal or an async method. Return `None`
when no product is found. Raise an exception to return its message as a lookup error.

The output must contain all six fields in the example. Other product fields are
allowed. The optional `__image_url` field supplies a product picture URL. Only an
administrator who can write to the data directory can install plugin code.

Call `GET /api/stock/barcodes/external-lookup/{barcode}` to check a barcode. Add
`?add=true` to save the product. The API checks the master data edit permission
before it calls the plugin. Product, barcode, and unit conversion writes use the
legacy order. A later error can leave earlier writes in the database.

`OpenFoodFactsBarcodeLookupPlugin` and `DemoBarcodeLookupPlugin` are bundled Python
implementations. The demo returns no result for `nothing`, an error for `error`,
and a sample product for other barcodes.
