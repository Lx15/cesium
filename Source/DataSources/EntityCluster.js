/*global define*/
define([
    '../Core/BoundingRectangle',
    '../Core/Cartesian2',
    '../Core/Cartesian3',
    '../Core/Color',
    '../Core/defaultValue',
    '../Core/defined',
    '../Core/defineProperties',
    '../Core/destroyObject',
    '../Core/EllipsoidalOccluder',
    '../Core/Event',
    '../Core/Matrix4',
    '../Scene/Billboard',
    '../Scene/BillboardCollection',
    '../Scene/HeightReference',
    '../Scene/HorizontalOrigin',
    '../Scene/LabelCollection',
    '../Scene/LabelStyle',
    '../Scene/PointPrimitiveCollection',
    '../Scene/SceneTransforms',
    '../Scene/VerticalOrigin',
    '../ThirdParty/kdbush',
    './Entity',
    './Property'
], function(
    BoundingRectangle,
    Cartesian2,
    Cartesian3,
    Color,
    defaultValue,
    defined,
    defineProperties,
    destroyObject,
    EllipsoidalOccluder,
    Event,
    Matrix4,
    Billboard,
    BillboardCollection,
    HeightReference,
    HorizontalOrigin,
    LabelCollection,
    LabelStyle,
    PointPrimitiveCollection,
    SceneTransforms,
    VerticalOrigin,
    kdbush,
    Entity,
    Property) {
    'use strict';

    function getX(point) {
        return point.coord.x;
    }

    function getY(point) {
        return point.coord.y;
    }

    function getLabelBoundingBox(label, coord, pixelRange) {
        var width = 0;
        var height = Number.NEGATIVE_INFINITY;

        var glyphs = label._glyphs;
        var length = glyphs.length;
        for (var i = 0; i < length; ++i) {
            var glyph = glyphs[i];
            var billboard = glyph.billboard;
            if (!defined(billboard)) {
                continue;
            }

            width += billboard.width;
            height = Math.max(height, billboard.height);
        }

        var scale = label.scale;
        width *= scale;
        height *= scale;

        var x = coord.x;
        if (label.horizontalOrigin === HorizontalOrigin.RIGHT) {
            x -= width;
        } else if (label.horizontalOrigin === HorizontalOrigin.CENTER) {
            x -= width * 0.5;
        }

        var y = coord.y;
        if (label.verticalOrigin === VerticalOrigin.TOP) {
            y -= height;
        } else if (label.verticalOrigin === VerticalOrigin.CENTER) {
            y -= height * 0.5;
        }

        x -= pixelRange;
        y -= pixelRange;
        width += pixelRange * 2.0;
        height += pixelRange * 2.0;

        return new BoundingRectangle(x, y, width, height);
    }

    function getBillboardBoundingBox(billboard, coord, pixelRange) {
        var width = billboard.width;
        var height = billboard.height;

        var scale = billboard.scale;
        width *= scale;
        height *= scale;

        var x = coord.x;
        if (billboard.horizontalOrigin === HorizontalOrigin.RIGHT) {
            x += width * 0.5;
        } else if (billboard.horizontalOrigin === HorizontalOrigin.LEFT) {
            x -= width * 0.5;
        }

        var y = coord.y;
        if (billboard.verticalOrigin === VerticalOrigin.TOP) {
            y -= height;
        } else if (billboard.verticalOrigin === VerticalOrigin.CENTER) {
            y -= height * 0.5;
        }

        x -= pixelRange;
        y -= pixelRange;
        width += pixelRange * 2.0;
        height += pixelRange * 2.0;

        return new BoundingRectangle(x, y, width, height);
    }

    function getPointBoundingBox(point, coord, pixelRange) {
        var size = point.pixelSize;
        var halfSize = size * 0.5;

        var x = coord.x - halfSize - pixelRange * 0.5;
        var y = coord.y - halfSize - pixelRange * 0.5;
        var width = size + pixelRange * 2.0;
        var height = size + pixelRange * 2.0;

        return new BoundingRectangle(x, y, width, height);
    }

    function getBoundingBox(item, coord, pixelRange, entityCluster) {
        var bbox;

        if (defined(item._labelCollection)) {
            bbox = getLabelBoundingBox(item, coord, pixelRange);
        } else if (defined(item._billboardCollection)) {
            bbox = getBillboardBoundingBox(item, coord, pixelRange);
        } else if (defined(item._pointPrimitiveCollection)) {
            bbox = getPointBoundingBox(item, coord, pixelRange);
        }

        if (!defined(item._labelCollection) && defined(item.id._label)) {
            var labelIndex = item.id._labelIndex;
            var label = entityCluster._labelCollection.get(labelIndex);
            bbox = BoundingRectangle.union(bbox, getLabelBoundingBox(label, coord, pixelRange), bbox);
        }

        return bbox;
    }

    function addNonClusteredItem(item, entityCluster) {
        item._clusterRender = true;

        if (!defined(item._labelCollection) && defined(item.id._label)) {
            var labelIndex = item.id._labelIndex;
            var label = entityCluster._labelCollection.get(labelIndex);
            label._clusterRender = true;
        }
    }

    var defaultFont = '30px sans-serif';
    var defaultStyle = LabelStyle.FILL;
    var defaultFillColor = Color.WHITE;
    var defaultOutlineColor = Color.BLACK;
    var defaultOutlineWidth = 1.0;

    function addCluster(position, numPoints, ids, entityCluster) {
        var entity = new Entity({
            position : position,
            label : {
                text : numPoints.toLocaleString()
            }
        });

        entityCluster._clusterEvent.raiseEvent(ids, entity);

        var labelGraphics = entity._label;

        var hasLabel = defined(labelGraphics);
        hasLabel = hasLabel && defined(labelGraphics._text) && Property.isConstant(labelGraphics._text);
        hasLabel = hasLabel && (!defined(labelGraphics._font) || Property.isConstant(labelGraphics._font));
        hasLabel = hasLabel && (!defined(labelGraphics._style) || Property.isConstant(labelGraphics._style));
        hasLabel = hasLabel && (!defined(labelGraphics._fillColor) || Property.isConstant(labelGraphics._fillColor));
        hasLabel = hasLabel && (!defined(labelGraphics._outlineColor) || Property.isConstant(labelGraphics._outlineColor));
        hasLabel = hasLabel && (!defined(labelGraphics._outlineWidth) || Property.isConstant(labelGraphics._outlineWidth));

        if (hasLabel) {
            var label = entityCluster._clusterLabelCollection.add();

            label.show = true;
            label.position = position;
            label.text = Property.getValueOrUndefined(labelGraphics._text, undefined);
            label.font = Property.getValueOrDefault(labelGraphics._font, undefined, defaultFont);
            label.style = Property.getValueOrDefault(labelGraphics._style, undefined, defaultStyle);
            label.fillColor = Property.getValueOrDefault(labelGraphics._fillColor, undefined, defaultFillColor);
            label.outlineColor = Property.getValueOrDefault(labelGraphics._outlineColor, undefined, defaultOutlineColor);
            label.outlineWidth = Property.getValueOrDefault(labelGraphics._outlineWidth, undefined, defaultOutlineWidth);

            label.id = ids;
        }

        var billboardGraphics = entity._billboard;
        if (defined(billboardGraphics) && defined(billboardGraphics._image) && Property.isConstant(billboardGraphics._image)) {
            var billboard = entityCluster._clusterBillboardCollection.add();

            billboard.show = true;
            billboard.position = position;
            billboard.image = billboardGraphics._image.getValue();

            billboard.id = ids;
        }
    }

    function getScreenSpacePositions(collection, points, scene, occluder) {
        if (!defined(collection)) {
            return;
        }

        var length = collection.length;
        for (var i = 0; i < length; ++i) {
            var item = collection.get(i);
            item._clusterRender = false;

            if (!item.show || !occluder.isPointVisible(item.position)) {
                continue;
            }

            if (defined(item._labelCollection) && (defined(item.id._billboard) || defined(item.id._point))) {
                continue;
            }

            var coord = item.computeScreenSpacePosition(scene);
            if (!defined(coord)) {
                continue;
            }

            points.push({
                index : i,
                collection : collection,
                clustered : false,
                coord : coord
            });
        }
    }

    function createDeclutterCallback(entityCluster) {
        return function(amount) {
            if ((defined(amount) && amount < 0.05) || !entityCluster.enabled) {
                return;
            }

            var scene = entityCluster._scene;

            var labelCollection = entityCluster._labelCollection;
            var billboardCollection = entityCluster._billboardCollection;
            var pointCollection = entityCluster._pointCollection;

            if (!defined(labelCollection) && !defined(billboardCollection) && !defined(pointCollection)) {
                return;
            }

            var clusteredLabelCollection = entityCluster._clusterLabelCollection;
            var clusteredBillboardCollection = entityCluster._clusterBillboardCollection;
            var clusteredPointCollection = entityCluster._clusterPointCollection;

            if (defined(clusteredLabelCollection)) {
                clusteredLabelCollection.removeAll();
            } else {
                clusteredLabelCollection = entityCluster._clusterLabelCollection = new LabelCollection({
                    scene : scene
                });
            }

            if (defined(clusteredBillboardCollection)) {
                clusteredBillboardCollection.removeAll();
            } else {
                clusteredBillboardCollection = entityCluster._clusterBillboardCollection = new BillboardCollection({
                    scene : scene
                });
            }

            if (defined(clusteredPointCollection)) {
                clusteredPointCollection.removeAll();
            } else {
                clusteredPointCollection = entityCluster._clusterPointCollection = new PointPrimitiveCollection();
            }

            var pixelRange = entityCluster._pixelRange;
            var minimumClusterSize = entityCluster._minimumClusterSize;

            var clusters = entityCluster._previousClusters;
            var newClusters = [];

            var previousHeight = entityCluster._previousHeight;
            var currentHeight = scene.camera.positionCartographic.height;

            var ellipsoid = scene.mapProjection.ellipsoid;
            var cameraPosition = scene.camera.positionWC;
            var occluder = new EllipsoidalOccluder(ellipsoid, cameraPosition);

            var points = [];
            getScreenSpacePositions(labelCollection, points, scene, occluder);
            getScreenSpacePositions(billboardCollection, points, scene, occluder);
            getScreenSpacePositions(pointCollection, points, scene, occluder);

            var i;
            var j;
            var length;
            var bbox;
            var neighbors;
            var neighborLength;
            var neighborIndex;
            var neighborPoint;
            var ids;
            var numPoints;

            var collection;
            var collectionIndex;

            var index = kdbush(points, getX, getY, 64, Int32Array);

            if (currentHeight < previousHeight) {
                length = clusters.length;
                for (i = 0; i < length; ++i) {
                    var cluster = clusters[i];

                    if (!occluder.isPointVisible(cluster.position)) {
                        continue;
                    }

                    var coord = Billboard._computeScreenSpacePosition(Matrix4.IDENTITY, cluster.position, Cartesian3.ZERO, Cartesian2.ZERO, scene);
                    if (!defined(coord)) {
                        continue;
                    }

                    var factor = 1.0 - currentHeight / previousHeight;
                    var width = cluster.width = cluster.width * factor;
                    var height = cluster.height = cluster.height * factor;

                    width = Math.max(width, cluster.minimumWidth);
                    height = Math.max(height, cluster.minimumHeight);

                    var minX = coord.x - width * 0.5;
                    var minY = coord.y - height * 0.5;
                    var maxX = coord.x + width;
                    var maxY = coord.y + height;

                    neighbors = index.range(minX, minY, maxX, maxY);
                    neighborLength = neighbors.length;
                    numPoints = 0;
                    ids = [];

                    for (j = 0; j < neighborLength; ++j) {
                        neighborIndex = neighbors[j];
                        neighborPoint = points[neighborIndex];
                        if (!neighborPoint.clustered) {
                            ++numPoints;

                            collection = neighborPoint.collection;
                            collectionIndex = neighborPoint.index;
                            ids.push(collection.get(collectionIndex).id);
                        }
                    }

                    if (numPoints >= minimumClusterSize) {
                        addCluster(cluster.position, numPoints, ids, entityCluster);
                        newClusters.push(cluster);

                        for (j = 0; j < neighborLength; ++j) {
                            points[neighbors[j]].clustered = true;
                        }
                    }
                }
            }

            length = points.length;
            for (i = 0; i < length; ++i) {
                var point = points[i];
                if (point.clustered) {
                    continue;
                }

                point.clustered = true;

                collection = point.collection;
                collectionIndex = point.index;

                var item = collection.get(collectionIndex);
                bbox = getBoundingBox(item, point.coord, pixelRange, entityCluster);
                var totalBBox = BoundingRectangle.clone(bbox);

                neighbors = index.range(bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height);
                neighborLength = neighbors.length;

                var clusterPosition = Cartesian3.clone(item.position);
                numPoints = 1;
                ids = [item.id];

                for (j = 0; j < neighborLength; ++j) {
                    neighborIndex = neighbors[j];
                    neighborPoint = points[neighborIndex];
                    if (!neighborPoint.clustered) {
                        var neighborItem = neighborPoint.collection.get(neighborPoint.index);
                        var neighborBBox = getBoundingBox(neighborItem, neighborPoint.coord, pixelRange, entityCluster);

                        Cartesian3.add(neighborItem.position, clusterPosition, clusterPosition);

                        BoundingRectangle.union(totalBBox, neighborBBox, totalBBox);
                        ++numPoints;

                        ids.push(neighborItem.id);
                    }
                }

                if (numPoints >= minimumClusterSize) {
                    var position = Cartesian3.multiplyByScalar(clusterPosition, 1.0 / numPoints, clusterPosition);
                    addCluster(position, numPoints, ids, entityCluster);
                    newClusters.push({
                        position : position,
                        width : totalBBox.width,
                        height : totalBBox.height,
                        minimumWidth : bbox.width,
                        minimumHeight : bbox.height
                    });

                    for (j = 0; j < neighborLength; ++j) {
                        points[neighbors[j]].clustered = true;
                    }
                } else {
                    addNonClusteredItem(item, entityCluster);
                }
            }

            if (clusteredLabelCollection.length === 0) {
                clusteredLabelCollection.destroy();
                entityCluster._clusterLabelCollection = undefined;
            }

            if (clusteredBillboardCollection.length === 0) {
                clusteredBillboardCollection.destroy();
                entityCluster._clusterBillboardCollection = undefined;
            }

            if (clusteredPointCollection.length === 0) {
                clusteredPointCollection.destroy();
                entityCluster._clusterPointCollection = undefined;
            }

            entityCluster._previousClusters = newClusters;
            entityCluster._previousHeight = currentHeight;
        };
    }

    /**
     * Defines how screen space objects (billboards, points, labels) are clustered.
     *
     * @param {Object} [options] An object with the following properties:
     * @param {Boolean} [options.enabled=false] Whether or not to enable clustering.
     * @param {Number} [options.pixelRange=80] The pixel range to extend the screen space bounding box.
     * @param {Number} [options.minimumClusterSize=2] The minimum number of screen space objects that can be clustered.
     *
     * @alias EntityCluster
     * @constructor
     *
     * @demo {@link http://cesiumjs.org/Cesium/Apps/Sandcastle/index.html?src=Clustering.html|Cesium Sandcastle Clustering Demo}
     */
    function EntityCluster(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        this._enabled = defaultValue(options.enabled, false);
        this._pixelRange = defaultValue(options.pixelRange, 80);
        this._minimumClusterSize = defaultValue(options.minimumClusterSize, 2);

        this._labelCollection = undefined;
        this._billboardCollection = undefined;
        this._pointCollection = undefined;

        this._clusterBillboardCollection = undefined;
        this._clusterLabelCollection = undefined;
        this._clusterPointCollection = undefined;

        this._unusedLabelIndices = [];
        this._unusedBillboardIndices = [];
        this._unusedPointIndices = [];

        this._previousClusters = [];
        this._previousHeight = undefined;

        this._enabledDirty = false;
        this._pixelRangeDirty = false;
        this._minimumClusterSizeDirty = false;

        this._cluster = undefined;
        this._removeEventListener = undefined;

        this._clusterEvent = new Event();
    }

    EntityCluster.prototype._initialize = function(scene) {
        this._scene = scene;

        var cluster = createDeclutterCallback(this);
        this._cluster = cluster;
        this._removeEventListener = scene.camera.changed.addEventListener(cluster);
    };

    defineProperties(EntityCluster.prototype, {
        /**
         * Gets or sets whether clustering is enabled.
         * @memberof EntityCluster.prototype
         * @type {Boolean}
         */
        enabled : {
            get : function() {
                return this._enabled;
            },
            set : function(value) {
                this._enabledDirty = value !== this._enabled;
                this._enabled = value;
            }
        },
        /**
         * Gets or sets the pixel range to extend the screen space bounding box.
         * @memberof EntityCluster.prototype
         * @type {Number}
         */
        pixelRange : {
            get : function() {
                return this._pixelRange;
            },
            set : function(value) {
                this._pixelRangeDirty = value !== this._pixelRange;
                this._pixelRange = value;
            }
        },
        /**
         * Gets or sets the minimum number of screen space objects that can be clustered.
         * @memberof EntityCluster.prototype
         * @type {Number}
         */
        minimumClusterSize : {
            get : function() {
                return this._minimumClusterSize;
            },
            set : function(value) {
                this._minimumClusterSizeDirty = value !== this._minimumClusterSize;
                this._minimumClusterSize = value;
            }
        },
        /**
         * Gets the event that will be raised when a new cluster will be displayed. The signature of the event listener is {@link EntityCluster~newClusterCallback}.
         * @memberof EntityCluster.prototype
         * @type {Event}
         */
        clusterEvent : {
            get : function() {
                return this._clusterEvent;
            }
        }
    });

    /**
     * Returns a new {@link Label}.
     * @param {Entity} entity The entity that will use the returned {@link Label} for visualization.
     * @returns {Label} The label that will be used to visualize an entity.
     *
     * @private
     */
    EntityCluster.prototype.getLabel = function(entity) {
        var labelCollection = this._labelCollection;
        if (defined(labelCollection) && defined(entity._labelIndex)) {
            return labelCollection.get(entity._labelIndex);
        }

        if (!defined(labelCollection)) {
            labelCollection = this._labelCollection = new LabelCollection({
                scene : this._scene
            });
        }

        var index;
        var label;

        var unusedIndices = this._unusedLabelIndices;
        if (unusedIndices.length > 0) {
            index = unusedIndices.pop();
            label = labelCollection.get(index);
        } else {
            label = labelCollection.add();
            index = labelCollection.length - 1;
        }

        entity._labelIndex = index;
        return label;
    };

    /**
     * Removes the {@link Label} associated with an entity so it can be reused by another entity.
     * @param {Entity} entity The entity that will uses the returned {@link Label} for visualization.
     *
     * @private
     */
    EntityCluster.prototype.removeLabel = function(entity) {
        if (!defined(this._labelCollection) || !defined(entity._labelIndex)) {
            return;
        }

        var index = entity._labelIndex;
        entity._labelIndex = undefined;

        var label = this._labelCollection.get(index);
        label.show = false;
        label.id = undefined;

        this._unusedLabelIndices.push(index);
    };

    /**
     * Returns a new {@link Billboard}.
     * @param {Entity} entity The entity that will use the returned {@link Billboard} for visualization.
     * @returns {Billboard} The label that will be used to visualize an entity.
     *
     * @private
     */
    EntityCluster.prototype.getBillboard = function(entity) {
        var billboardCollection = this._billboardCollection;
        if (defined(billboardCollection) && defined(entity._billboardIndex)) {
            return billboardCollection.get(entity._billboardIndex);
        }

        if (!defined(billboardCollection)) {
            billboardCollection = this._billboardCollection = new BillboardCollection({
                scene : this._scene
            });
        }

        var index;
        var billboard;

        var unusedIndices = this._unusedBillboardIndices;
        if (unusedIndices.length > 0) {
            index = unusedIndices.pop();
            billboard = billboardCollection.get(index);
        } else {
            billboard = billboardCollection.add();
            index = billboardCollection.length - 1;
        }

        entity._billboardIndex = index;
        return billboard;
    };

    /**
     * Removes the {@link Billboard} associated with an entity so it can be reused by another entity.
     * @param {Entity} entity The entity that will uses the returned {@link Billboard} for visualization.
     *
     * @private
     */
    EntityCluster.prototype.removeBillboard = function(entity) {
        if (!defined(this._billboardCollection) || !defined(entity._billboardIndex)) {
            return;
        }

        var index = entity._billboardIndex;
        entity._billboardIndex = undefined;

        var billboard = this._billboardCollection.get(index);
        billboard.id = undefined;
        billboard.show = false;
        billboard.image = undefined;

        this._unusedBillboardIndices.push(index);
    };

    /**
     * Returns a new {@link Point}.
     * @param {Entity} entity The entity that will use the returned {@link Point} for visualization.
     * @returns {Point} The label that will be used to visualize an entity.
     *
     * @private
     */
    EntityCluster.prototype.getPoint = function(entity) {
        var pointCollection = this._pointCollection;
        if (defined(pointCollection) && defined(entity._pointIndex)) {
            return pointCollection.get(entity._pointIndex);
        }

        if (!defined(pointCollection)) {
            pointCollection = this._pointCollection = new PointPrimitiveCollection();
        }

        var index;
        var point;

        var unusedIndices = this._unusedPointIndices;
        if (unusedIndices.length > 0) {
            index = unusedIndices.pop();
            point = pointCollection.get(index);
        } else {
            point = pointCollection.add();
            index = pointCollection.length - 1;
        }

        entity._pointIndex = index;
        return point;
    };

    /**
     * Removes the {@link Point} associated with an entity so it can be reused by another entity.
     * @param {Entity} entity The entity that will uses the returned {@link Point} for visualization.
     *
     * @private
     */
    EntityCluster.prototype.removePoint = function(entity) {
        if (!defined(this._pointCollection) || !defined(entity._pointIndex)) {
            return;
        }

        var index = entity._pointIndex;
        entity._pointIndex = undefined;

        var point = this._pointCollection.get(index);
        point.show = false;
        point.id = undefined;

        this._unusedPointIndices.push(index);
    };

    function disableCollectionClustering(collection) {
        if (!defined(collection)) {
            return;
        }

        var length = collection.length;
        for (var i = 0; i < length; ++i) {
            collection.get(i)._clusterRender = true;
        }
    }

    function updateEnable(entityCluster) {
        if (entityCluster.enabled) {
            entityCluster._cluster();
            return;
        }

        if (defined(entityCluster._clusterLabelCollection)) {
            entityCluster._clusterLabelCollection.destroy();
        }
        if (defined(entityCluster._clusterBillboardCollection)) {
            entityCluster._clusterBillboardCollection.destroy();
        }
        if (defined(entityCluster._clusterPointCollection)) {
            entityCluster._clusterPointCollection.destroy();
        }

        entityCluster._clusterLabelCollection = undefined;
        entityCluster._clusterBillboardCollection = undefined;
        entityCluster._clusterPointCollection = undefined;

        disableCollectionClustering(entityCluster._labelCollection);
        disableCollectionClustering(entityCluster._billboardCollection);
        disableCollectionClustering(entityCluster._pointCollection);
    }

    /**
     * Gets the draw commands for the clustered billboards/points/labels if enabled, otherwise,
     * queues the draw commands for billboards/points/labels created for entities.
     * @private
     */
    EntityCluster.prototype.update = function(frameState) {
        if (this._enabledDirty) {
            this._enabledDirty = false;
            updateEnable(this);
        }

        if (this._pixelRangeDirty || this._minimumClusterSizeDirty) {
            this._pixelRangeDirty = false;
            this._minimumClusterSizeDirty = false;
            this._cluster();
        }

        if (defined(this._clusterLabelCollection)) {
            this._clusterLabelCollection.update(frameState);
        }
        if (defined(this._clusterBillboardCollection)) {
            this._clusterBillboardCollection.update(frameState);
        }
        if (defined(this._clusterPointCollection)) {
            this._clusterPointCollection.update(frameState);
        }

        if (defined(this._labelCollection)) {
            this._labelCollection.update(frameState);
        }
        if (defined(this._billboardCollection)) {
            this._billboardCollection.update(frameState);
        }
        if (defined(this._pointCollection)) {
            this._pointCollection.update(frameState);
        }
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <p>
     * Unlike other objects that use WebGL resources, this object can be reused. For example, if a data source is removed
     * from a data source collection and added to another.
     * </p>
     *
     * @returns {undefined}
     */
    EntityCluster.prototype.destroy = function() {
        this._labelCollection = this._labelCollection && this._labelCollection.destroy();
        this._billboardCollection = this._billboardCollection && this._billboardCollection.destroy();
        this._pointCollection = this._pointCollection && this._pointCollection.destroy();

        this._clusterLabelCollection = this._clusterLabelCollection && this._clusterLabelCollection.destroy();
        this._clusterBillboardCollection = this._clusterBillboardCollection && this._clusterBillboardCollection.destroy();
        this._clusterPointCollection = this._clusterPointCollection && this._clusterPointCollection.destroy();

        if (defined(this._removeEventListener)) {
            this._removeEventListener();
            this._removeEventListener = undefined;
        }

        this._labelCollection = undefined;
        this._billboardCollection = undefined;
        this._pointCollection = undefined;

        this._clusterBillboardCollection = undefined;
        this._clusterLabelCollection = undefined;
        this._clusterPointCollection = undefined;

        this._unusedLabelIndices = [];
        this._unusedBillboardIndices = [];
        this._unusedPointIndices = [];

        this._previousClusters = [];
        this._previousHeight = undefined;

        this._enabledDirty = false;
        this._pixelRangeDirty = false;
        this._minimumClusterSizeDirty = false;

        return undefined;
    };

    /**
     * A event listener function used to style clusters.
     * @callback EntityCluster~newClusterCallback
     *
     * @param {Entity[]} clusteredEntities An array of the entities contained in the cluster.
     * @param {Entity} entity The entity that will be display for the cluster.
     *
     * @example
     * dataSource.clustering.clusterEvent.addEventListener(function(entities, entity) {
     *     entity.label = {
     *         text : '' + entities.length
     *     };
     * });
     */

    return EntityCluster;
});