"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
exports.__esModule = true;
exports.sourceNodes = exports.onCreateNode = exports.createSchemaCustomization = void 0;
var _gatsbySourceFilesystem = require("gatsby-source-filesystem");
var _awsSdk = _interopRequireDefault(require("aws-sdk"));
const isImage = key => /\.(jpe?g|png|webp|tiff?|pdf)$/i.test(key);
// source all objects from s3
const sourceNodes = async function ({
  actions: {
    createNode
  },
  createNodeId,
  createContentDigest,
  reporter
}, pluginOptions) {
  const {
    aws: awsConfig,
    buckets,
    expiration = 900
  } = pluginOptions;

  // configure aws
  _awsSdk.default.config.update(awsConfig);
  const s3 = new _awsSdk.default.S3();
  reporter.verbose(`AWS S3 Config: ${JSON.stringify(s3.config, undefined, 2)}`);

  // get objects
  const getS3ListObjects = async parameters => {
    return await s3.listObjectsV2(parameters).promise();
  };
  const listAllS3Objects = async bucket => {
    const allS3Objects = [];
    try {
      const data = await getS3ListObjects({
        Bucket: bucket
      });
      if (data && data.Contents) {
        for (const object of data.Contents) {
          allS3Objects.push({
            ...object,
            Bucket: bucket
          });
        }
      } else {
        reporter.error(`Error processing objects from bucket "${bucket}". Is it empty?`, new Error("No object in Bucket"), "gatsby-source-s3");
      }
      let nextToken = data && data.IsTruncated && data.NextContinuationToken;
      while (nextToken) {
        const data = await getS3ListObjects({
          Bucket: bucket,
          ContinuationToken: nextToken
        });
        if (data && data.Contents) {
          for (const object of data.Contents) {
            allS3Objects.push({
              ...object,
              Bucket: bucket
            });
          }
        }
        nextToken = data && data.IsTruncated && data.NextContinuationToken;
      }
    } catch (error) {
      reporter.panicOnBuild(`Error listing S3 objects on bucket "${bucket}"`, error);
    }
    return allS3Objects;
  };
  try {
    const allBucketsObjects = await Promise.all(buckets.map(bucket => listAllS3Objects(bucket)));

    // flatten objects
    const objects = allBucketsObjects.flat();

    // create file nodes
    for (const object of objects) {
      const {
        Bucket,
        Key
      } = object;
      // get pre-signed URL
      const url = s3.getSignedUrl("getObject", {
        Bucket,
        Key,
        Expires: expiration
      });
      createNode({
        ...object,
        url,
        // node meta
        id: createNodeId(`s3-object-${Key}`),
        parent: undefined,
        children: [],
        internal: {
          type: "S3Object",
          content: JSON.stringify(object),
          contentDigest: createContentDigest(object)
        }
      });
    }
  } catch (error) {
    reporter.error(`Error sourcing nodes: ${error}`);
  }
};
exports.sourceNodes = sourceNodes;
const onCreateNode = async function ({
  node,
  actions: {
    createNode,
    createNodeField
  },
  cache,
  reporter,
  createNodeId
}) {
  if (node.internal.type === "S3Object" && node.Key && isImage(node.Key)) {
    try {
      // download image file and save as node
      const imageFile = await (0, _gatsbySourceFilesystem.createRemoteFileNode)({
        url: node.url,
        parentNodeId: node.id,
        cache,
        createNode,
        createNodeId
      });
      if (imageFile) {
        // add local image file to s3 object node
        createNodeField({
          node,
          name: "localFile",
          value: imageFile.id
        });
      }
    } catch (error) {
      reporter.error(`Error creating file node for S3 object key "${node.Key}": ${error}`);
    }
  }
};
exports.onCreateNode = onCreateNode;
const createSchemaCustomization = async function ({
  actions
}) {
  actions.createTypes(`
    type S3Object implements Node {
      Key: String!
      Bucket: String!
      LastModified: Date! @dateformat
      Size: Int!
      localFile: File @link(from: "fields.localFile")
    }
  `);
};
exports.createSchemaCustomization = createSchemaCustomization;