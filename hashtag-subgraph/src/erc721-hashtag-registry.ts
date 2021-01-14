import { BigInt, Bytes, ipfs, json, JSONValue } from "@graphprotocol/graph-ts";

import {
  HashtagRegistered,
  ERC721HashtagRegistry,
} from "../generated/ERC721HashtagRegistry/ERC721HashtagRegistry";

import { HashtagProtocol } from "../generated/HashtagProtocol/HashtagProtocol";
import { Tag, Hashtag } from "../generated/schema";

import {
  safeLoadPublisher,
  safeLoadPlatform,
  safeLoadOwner,
  safeLoadTagger,
  extractNftIPFSMetadata,
  ONE,
} from "./helpers";

/*
 * Track the tagging of an NFT asset
 *
 * event.params.hashtagId NFT ID of the hashtag
 * event.params.nftContract Contract address of the NFT asset being tagged
 * event.params.nftId NFT ID of the NFT asset being tagged
 * event.params.tagger Ethereum address that initiated the tag
 * event.params.publisher Publisher that facilitated the tag
 * event.params.hashtagFee Fee earned by the owner of the hashtag
 * event.params.publisherFee Fee earned by the publisher that facilitated the tagging
 * event.params.platformFee Fee earned by the Hashtag Protocol
 *
 * Notes
 *    A number of data points are generated off the back of this tagging event:
 *     - Tag / usage count for a hashtag
 *     - NFT asset metadata including name, description and image
 *     - Tagging fees earned by the hashtag owner, publisher and platform
 */
export function handleHashtagRegistered(event: HashtagRegistered): void {
  let registryContract = ERC721HashtagRegistry.bind(event.address);

  let tagFee = registryContract.tagFee();
  let modulo = registryContract.modulo();
  let platformPercentageOfTagFee = registryContract.platformPercentage();
  let publisherPercentageOfTagFee = registryContract.publisherPercentage();
  let remainingPercentage = modulo.minus(platformPercentageOfTagFee).minus(publisherPercentageOfTagFee);

  let protocolAddress = registryContract.hashtagProtocol();
  let protocolContract = HashtagProtocol.bind(protocolAddress);
  let platformAddress = protocolContract.platform();

  let hashtagId = event.params.hashtagId;
  let owner = protocolContract.ownerOf(hashtagId);

  let publisherFee = tagFee.times(publisherPercentageOfTagFee).div(modulo);
  let platformFee = tagFee.times(platformPercentageOfTagFee).div(modulo);
  let remainingFee = tagFee.times(remainingPercentage).div(modulo);

  let hashtag = Hashtag.load(hashtagId.toString());

  // this is a pre-auction state if true or post-auction if false
  if (owner.equals(platformAddress)) {
    hashtag.creatorRevenue = hashtag.creatorRevenue.plus(remainingFee);

    // Update creator counts and fees
    let creator = protocolContract.getCreatorAddress(hashtagId);
    let ownerEntity = safeLoadOwner(creator.toHexString());
    ownerEntity.tagCount = ownerEntity.tagCount.plus(ONE);
    ownerEntity.tagFees = ownerEntity.tagFees.plus(remainingFee);
    ownerEntity.save();
  } else {
    hashtag.ownerRevenue = hashtag.ownerRevenue.plus(remainingFee);

    // Update owner counts and fees
    let ownerEntity = safeLoadOwner(owner.toHexString());
    ownerEntity.tagCount = ownerEntity.tagCount.plus(ONE);
    ownerEntity.tagFees = ownerEntity.tagFees.plus(remainingFee);
    ownerEntity.save();
  }

  // Update rest of hashtag data
  hashtag.tagCount = hashtag.tagCount.plus(ONE);
  hashtag.publisherRevenue = hashtag.publisherRevenue.plus(publisherFee);
  hashtag.protocolRevenue = hashtag.protocolRevenue.plus(platformFee);
  hashtag.save();

  // Store tag information
  let tagEntity = new Tag(event.transaction.hash.toHexString());
  tagEntity.hashtagId = hashtagId.toString();
  tagEntity.hashtagDisplayHashtag = hashtag.displayHashtag;
  tagEntity.nftContract = event.params.nftContract;
  tagEntity.nftId = event.params.nftId.toString();

  let erc721Contract = HashtagProtocol.bind(event.params.nftContract);
  tagEntity.nftContractName = erc721Contract.name();

  let tokenUriCallResult = erc721Contract.try_tokenURI(event.params.nftId);
  tagEntity.nftTokenUri = tokenUriCallResult.reverted
    ? null
    : tokenUriCallResult.value;

  if (!tokenUriCallResult.reverted) {
    let nftMetadata = extractNftIPFSMetadata(tagEntity.nftTokenUri);
    if (nftMetadata) {
      tagEntity.nftName = nftMetadata.nftName;
      tagEntity.nftDescription = nftMetadata.nftDescription;
      tagEntity.nftImage = nftMetadata.nftImage;
    }
  }

  tagEntity.tagger = event.params.tagger;
  tagEntity.timestamp = event.block.timestamp;
  tagEntity.publisher = event.params.publisher;
  tagEntity.save();

  // update publisher counts and fees
  let publisherEntity = safeLoadPublisher(event.params.publisher.toHexString());
  publisherEntity.tagCount = publisherEntity.tagCount.plus(ONE);
  publisherEntity.tagFees = publisherEntity.tagFees.plus(publisherFee);
  publisherEntity.save();

  // update platform fees
  let platform = safeLoadPlatform("platform");
  platform.tagFees = platform.tagFees.plus(platformFee);
  platform.save();

  // update tagger counts
  let tagger = safeLoadTagger(event.params.tagger.toHexString());
  tagger.tagCount = tagger.tagCount.plus(ONE);
  tagger.feesPaid = tagger.feesPaid.plus(tagFee);
  tagger.save();
}
